Feature: Thread task-state mapping
  The Threads surface narrows the broad controller-status union down to the chat
  task states it actually acts on, and maps each task state to a controller action.

  Scenario Outline: controller status narrows to a chat task state
    Given a controller status of "<status>"
    When the task state is derived
    Then the resulting task state is "<taskState>"

    Examples:
      | status               | taskState            |
      | idle                 | idle                 |
      | running              | running              |
      | awaiting_input       | awaiting_input       |
      | awaiting_permission  | awaiting_permission  |
      | permission_submitted | permission_submitted |
      | error                | error                |
      | stopping             | stopping             |
      | failed               | error                |
      | timed_out            | error                |
      | sending              | running              |
      | waiting              | running              |
      | polling              | running              |
      | activating           | running              |

  Scenario Outline: each task state maps to a named controller action
    Given a task state of "<taskState>"
    When the controller action is derived
    Then the resulting controller action is "<action>"

    Examples:
      | taskState            | action               |
      | idle                 | settled              |
      | running              | stream_started       |
      | awaiting_input       | input_requested      |
      | awaiting_permission  | permission_requested |
      | permission_submitted | permission_submitted |
      | stopping             | stop_started         |
      | error                | failed               |
