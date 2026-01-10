# Product language guide (draft)

## Goals

- Use plain language that makes sense to first time users.
- Keep names consistent across the app, marketing, and support docs.
- Prefer Discord terms in user facing copy, for example server instead of guild.

## Naming principles

- Use feature names that describe the value, not internal routes or data models.
- Keep short labels concise for navigation, and expand in descriptions.
- Avoid double names for the same feature unless one is clearly internal.

## Feature naming map

| Area            | User facing name | Short label | Description copy                                       | Avoid               |
| --------------- | ---------------- | ----------- | ------------------------------------------------------ | ------------------- |
| Meeting library | Meeting library  | Library     | Notes and transcripts from recorded meetings.          | Notes only, History |
| Q&A             | Q&A              | Q&A         | Get answers across meeting history and shared threads. | Ask, Ask threads    |
| Shared threads  | Shared threads   | Shared      | Read-only threads shared from Q&A.                     | Ask shares          |
| Live voice      | Live voice       | Live voice  | Real time voice responses in channel.                  | Live mode           |
| Auto-record     | Auto-record      | Auto-record | Automatically starts a recording when members join.    | Autorecord          |
| Billing         | Billing          | Billing     | Manage plan and payment details.                       | Subscribe           |
| Settings        | Settings         | Settings    | Configure notes, voice, and sharing preferences.       | Config              |

## Discord terms

- Server is the preferred term in UI and marketing copy.
- Guild is acceptable in code and APIs, but avoid it in user facing text.

## Copy checklist

- Use sentence case for headings and buttons.
- Prefer simple verbs like Open, View, Manage, and Share.
- Avoid feature codenames in user facing copy.
