Feature: Chat event gate
  The gate deduplicates and orders live chat events. It drops duplicate bridge
  events, late streaming updates after a turn settles, events from a superseded
  run, and stale Core run/stream updates — while still admitting Core payloads
  whose content changed.

  Scenario: a duplicate bridge update is dropped after the first acceptance
    Given a fresh event gate for the active run "run-1"
    When a bridge "update_message" event arrives for run "run-1" with content "working"
    Then it is accepted
    When a bridge "update_message" event arrives for run "run-1" with content "working"
    Then it is rejected

  Scenario: a late streaming update is rejected once the turn has settled
    Given a fresh event gate for the active run "run-1"
    When a bridge "typing_stop" event arrives for run "run-1"
    Then it is accepted
    When a bridge "update_message" event arrives for run "run-1" with content "late preview"
    Then it is rejected

  Scenario: an event from a superseded run is rejected
    Given a fresh event gate for the active run "run-old" with a pending turn superseding "run-old"
    When a bridge "reply" event arrives for run "run-old" with content "late answer"
    Then it is rejected

  Scenario: core refresh events deduplicate while allowing changed payloads
    Given a fresh event gate
    When a core "message.updated" event arrives for thread "thread-1" message "message-1" with content "one"
    Then it is accepted
    When a core "message.updated" event arrives for thread "thread-1" message "message-1" with content "one"
    Then it is rejected
    When a core "message.updated" event arrives for thread "thread-1" message "message-1" with content "two"
    Then it is accepted

  Scenario: late core stream updates are rejected after the run settles
    Given a fresh event gate
    When a core "stream.updated" event arrives with a "typing_stop" stream for run "run-1"
    Then it is accepted
    When a core "presence.updated" event arrives with an "update_message" stream for run "run-1" with content "late preview"
    Then it is rejected
    When a core "stream.updated" event arrives with a "reply" stream for run "run-1"
    Then it is rejected

  Scenario: a late running status is rejected once a core run has completed
    Given a fresh event gate
    When a core "run.updated" event arrives for run "run-1" with status "completed"
    Then it is accepted
    When a core "run.updated" event arrives for run "run-1" with status "running"
    Then it is rejected
