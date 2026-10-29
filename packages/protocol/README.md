# @isoplan/protocol

The wire protocol between [Isoplan](https://github.com/adamlinscott/isoplan-plugin)'s Claude Code plugin and an office server: the facts a session reports, the messages each side sends, and [zod](https://zod.dev) schemas that check them.

```
npm install @isoplan/protocol
```

ES module only, with TypeScript types. Depends on zod 4.

## What is in it

- **Facts** (`FactsSchema` and its parts: `SessionFactSchema`, `AgentFactSchema`, `FileFactSchema`, `WaitFactSchema`, `ReportFactSchema`, `QuestionFactSchema`): what one session reports, the shape a data layer sends and a server stores.
- **Messages**: `DataLayerMessageSchema` for what a data layer or runner sends (hellos, full facts, changes, replies, refusals, and the hand-over, take and taken steps of a handoff, and ask-room and ask-check for asking a handed-over room a question), and `OfficeServerMessageSchema` for what a server sends back (repair, conflict, error, request, release, handoff, and asked, where a question stands). Each message type has its own schema and type as well, such as `HelloMessage` or `RequestMessage`.
- **`PROTOCOL_VERSION`**: the version both sides speak. A message's `v` must match it.
- **`projectId(remoteUrl, { machine, root })`**: a repository's project id, `host/owner/repo` from its git remote whatever form the remote is written in, or `local:<machine>/<root>` without one.

## Parse a message

```ts
import { parseDataLayerMessage } from "@isoplan/protocol";

const result = parseDataLayerMessage(JSON.parse(text));
if (result.ok) handle(result.message);
else if (result.kind === "unsupported-version") reply(result.error); // a peer on another protocol version
else drop(result.error);
```

`parseOfficeServerMessage` does the same for the other direction. Neither throws.

## Licence

MIT. Source: [`packages/protocol`](https://github.com/adamlinscott/isoplan-plugin/tree/main/packages/protocol).
