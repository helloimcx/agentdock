Feature: Channel content shaping
  Outbound channel messages stay plain text when there are no attachments, but
  wrap into a structured input (display text + content parts) once non-text
  parts appear. Outbound file paths resolve against the workspace root.

  Scenario: a text-only message stays a plain string
    When a channel thread message is built from "Alice: hello" with a single text part "hello"
    Then the input is the plain text "Alice: hello"

  Scenario: a message with attachments wraps text and preserves content parts
    When a channel thread message is built from "Alice: see attached" with the parts:
      """
      [{"type":"text","text":"see attached"},{"type":"image","data":"aW1n","mimeType":"image/png","fileName":"a.png"},{"type":"file","path":"/tmp/report.pdf","fileName":"report.pdf"}]
      """
    Then the display text is "Alice: see attached"
    And there are 3 content parts

  Scenario Outline: outbound file paths resolve against the workspace root
    When a channel file path "<path>" is resolved against "<root>"
    Then the resolved path is "<resolved>"

    Examples:
      | path            | root               | resolved                           |
      | reports/out.pdf | /workspace/project | /workspace/project/reports/out.pdf |
      | /tmp/out.pdf    | /workspace/project | /tmp/out.pdf                       |
