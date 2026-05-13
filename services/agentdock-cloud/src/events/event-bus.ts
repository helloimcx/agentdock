import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { Producer, SimpleConsumer } from 'rocketmq-client-nodejs';
import type { AgentDockCloudEvent, AgentDockCloudEventEnvelope } from '../../../../packages/cloud-core/src/index.js';
import { tagForCloudEventType } from '../../../../packages/cloud-core/src/index.js';

export interface CloudEventBus {
  publish(event: AgentDockCloudEvent): Promise<AgentDockCloudEventEnvelope>;
  subscribe(listener: (envelope: AgentDockCloudEventEnvelope) => void | Promise<void>): () => void;
}

export class InProcessRocketMqBus implements CloudEventBus {
  private readonly emitter = new EventEmitter();
  private readonly seqByRun = new Map<string, number>();

  constructor(
    private readonly instanceId = `agentdock-cloud-${process.pid}`,
    private readonly runtimeImage = 'agentdock/pi-sandbox-runtime:local',
  ) {}

  async publish(event: AgentDockCloudEvent) {
    const envelope = this.toEnvelope(event);
    this.emitter.emit('event', envelope);
    return envelope;
  }

  subscribe(listener: (envelope: AgentDockCloudEventEnvelope) => void | Promise<void>) {
    const wrapped = (envelope: AgentDockCloudEventEnvelope) => {
      void listener(envelope);
    };
    this.emitter.on('event', wrapped);
    return () => this.emitter.off('event', wrapped);
  }

  private toEnvelope(event: AgentDockCloudEvent): AgentDockCloudEventEnvelope {
    const runId = 'runId' in event ? event.runId : 'task' in event ? event.task.runId : undefined;
    const taskId = 'taskId' in event ? event.taskId : 'task' in event ? event.task.taskId : undefined;
    const key = runId || taskId || 'global';
    const seq = (this.seqByRun.get(key) || 0) + 1;
    this.seqByRun.set(key, seq);
    const sandboxId = 'sandboxId' in event ? event.sandboxId : 'task' in event ? event.task.sandboxId : undefined;
    return {
      eventId: randomUUID(),
      type: event.type,
      taskId,
      runId,
      seq,
      createdAt: new Date().toISOString(),
      source: {
        service: 'agentdock-cloud',
        instanceId: this.instanceId,
        sandboxId,
        agentId: 'task' in event ? event.task.agentId : undefined,
        runtimeImage: this.runtimeImage,
      },
      event,
    };
  }
}

export function rocketMqTagForEnvelope(envelope: AgentDockCloudEventEnvelope) {
  return tagForCloudEventType(envelope.type);
}

export interface RocketMqEventBusOptions {
  endpoints: string;
  topic: string;
  consumerGroup: string;
  namespace: string;
  instanceId: string;
  runtimeImage: string;
}

export class RocketMqEventBus implements CloudEventBus {
  private readonly producer: Producer;
  private readonly consumer: SimpleConsumer;
  private readonly listeners = new Set<(envelope: AgentDockCloudEventEnvelope) => void | Promise<void>>();
  private readonly sequencer: InProcessRocketMqBus;
  private started = false;
  private stopped = false;

  constructor(private readonly options: RocketMqEventBusOptions) {
    this.producer = new Producer({
      endpoints: options.endpoints,
      namespace: options.namespace,
      topics: [options.topic],
      topic: options.topic,
    });
    this.consumer = new SimpleConsumer({
      endpoints: options.endpoints,
      namespace: options.namespace,
      consumerGroup: options.consumerGroup,
      subscriptions: new Map().set(options.topic, '*'),
    });
    this.sequencer = new InProcessRocketMqBus(options.instanceId, options.runtimeImage);
  }

  async startup() {
    if (this.started) {
      return;
    }
    await this.producer.startup();
    await this.consumer.startup();
    this.started = true;
    void this.poll();
  }

  async shutdown() {
    this.stopped = true;
    if (!this.started) {
      return;
    }
    await this.consumer.shutdown();
    await this.producer.shutdown();
  }

  async publish(event: AgentDockCloudEvent) {
    const envelope = await this.sequencer.publish(event);
    await this.producer.send({
      topic: this.options.topic,
      tag: rocketMqTagForEnvelope(envelope),
      keys: [envelope.eventId, envelope.taskId || '', envelope.runId || ''].filter(Boolean),
      body: Buffer.from(JSON.stringify(envelope)),
    });
    return envelope;
  }

  subscribe(listener: (envelope: AgentDockCloudEventEnvelope) => void | Promise<void>) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private async poll() {
    while (!this.stopped) {
      try {
        const messages = await this.consumer.receive(20);
        for (const message of messages) {
          const envelope = JSON.parse(message.body.toString('utf8')) as AgentDockCloudEventEnvelope;
          for (const listener of this.listeners) {
            await listener(envelope);
          }
          await this.consumer.ack(message);
        }
      } catch (error) {
        console.error('rocketmq consume failed', error);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }
}
