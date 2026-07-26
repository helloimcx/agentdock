Feature: Lark outbound message rendering
  The renderer decides how outbound markdown is delivered to Lark: as a plain
  post, an interactive schema-2.0 card for markdown tables, or a post fallback
  when the table count exceeds the platform limit. Non-http links are sanitized.

  Scenario: plain markdown renders as a post message
    When the lark text renderer processes:
      """
      ### 标题

      普通回复
      """
    Then the message type is "post"
    And the render kind is "post_md"
    And the render reason is "plain_markdown"
    And the table count is 0

  Scenario: a markdown table renders as a schema-2.0 interactive card
    When the lark text renderer processes a markdown body with 1 table
    Then the message type is "interactive"
    And the render kind is "markdown_card"
    And the render reason is "markdown_table"
    And the table count is 1
    And the card schema is "2.0"

  Scenario: too many tables fall back to a post
    When the lark text renderer processes a markdown body with 6 tables
    Then the message type is "post"
    And the render kind is "post_md"
    And the render reason is "table_limit_fallback"
    And the table count is 6
    And the rendered markdown contains "标题 6"

  Scenario: non-http markdown links are sanitized while http links survive
    When the lark text renderer processes:
      """
      [本地文件](file:///tmp/a.md) 和 [官网](https://example.com)
      """
    Then the rendered markdown contains "本地文件 (file:///tmp/a.md)"
    And the rendered markdown contains "[官网](https://example.com)"
