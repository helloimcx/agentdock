Feature: WeChat (weixin) text utilities
  Channel text helpers preserve UTF-8 byte boundaries when splitting or
  truncating message text, and decode simple HTML entities.

  Scenario: HTML entities and tags are stripped from message text
    When the text "<p>A&amp;B</p>" is stripped of WeChat HTML
    Then the stripped text is "A&B"

  Scenario: text is split on UTF-8 byte boundaries without breaking characters
    When the text "你好世界" is split into chunks of at most 6 UTF-8 bytes
    Then the chunks are:
      """
      你好
      世界
      """
    And each chunk is at most 6 UTF-8 bytes

  Scenario: truncation respects the UTF-8 byte limit
    When a long text is truncated to 80 UTF-8 bytes
    Then the result is at most 80 UTF-8 bytes
