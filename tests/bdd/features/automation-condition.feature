Feature: Automation condition evaluation and decisions
  Conditions decide whether an automation fires. Always and expression kinds
  evaluate directly, approved-script kinds delegate execution, and a concurrent
  evaluation is skipped without ever invoking the evaluator.

  Scenario: an always condition always matches
    Given an "always" condition
    When the condition is evaluated
    Then the evaluation is "matched"

  Scenario: an expression condition evaluates against its payload
    Given an "expression" condition with body:
      """
      price >= 100 && symbol == "AAPL"
      """
    And the payload:
      """
      {"price": 101, "symbol": "AAPL"}
      """
    When the condition is evaluated
    Then the evaluation is "matched"

  Scenario: a concurrent evaluation is skipped without invoking the evaluator
    Given an "always" condition
    And the previous match was false
    And evaluation is already running
    When the condition is decided
    Then the decision is "skipped_concurrent"
    And the evaluator was not called

  Scenario: an approved-script condition delegates execution as a script request
    Given an "approved-script" condition for script "script:1" version "version:2"
    And the payload:
      """
      {"price": 101}
      """
    When the condition is evaluated
    Then the evaluation delegates to script "script:1" version "version:2" carrying the payload
