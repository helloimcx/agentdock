Feature: Inbound attachment summarization
  Inbound non-text attachments are summarized into human-readable labels so the
  display text records what was received even when the message body is empty.

  Scenario: a lark file part summarizes to a file label
    When lark inbound parts are summarized:
      """
      [{"type":"file","fileName":"report.pdf"}]
      """
    Then the summary is "[File: report.pdf]"

  Scenario: an ACP thread message summarizes multiple attachments in order
    When an ACP thread message is normalized with empty text and the parts:
      """
      [{"type":"image","uri":"file:///tmp/a.png","fileName":"a.png"},{"type":"file","path":"/tmp/report.pdf","fileName":"report.pdf"}]
      """
    Then the summarized text is:
      """
      [Image: a.png]
      [File: report.pdf]
      """
