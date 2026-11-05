# @isoplan/protocol

The wire protocol between [Isoplan](https://github.com/isoplan-app/isoplan-plugin)'s Claude Code plugin and an office server: the facts a session reports, the messages each side sends, and [zod](https://zod.dev) schemas that check them.

```
npm install @isoplan/protocol
```

ES module only, with TypeScript types. Depends on zod 4.

## What is in it

- **Facts** (`FactsSchema` and its parts: `SessionFactSchema`, `AgentFactSchema`, `FileFactSchema`, `WaitFactSchema`, `ReportFactSchema`, `QuestionFactSchema`): what one session reports, the shape a data layer sends and a server stores.
- **Messages**: `DataLayerMessageSchema` for what a data layer or runner sends (hellos, full facts, changes, replies, refusals, and the hand-over, take and taken steps of a handoff, and ask-room, ask-check and asked-ack for asking a handed-over room a question), and `OfficeServerMessageSchema` for what a server sends back (repair, conflict, error, request, release, handoff, asked, where a question stands, and ask-rights, whether a session may ask). Each message type has its own schema and type as well, such as `HelloMessage` or `RequestMessage`.
- **Driven sessions** (0.5.0): a session the runner runs on its person's machine, which they drive from the floor. The server sends `drive` (start, instruct, stop, hand-back, output, answer a permission prompt, release withheld text), each naming who acts, and `drive-policy`, where skipping permission prompts is allowed. The runner sends `driven` (started, turn-started, tool, reply, turn-ended, error, output, prompt, prompt-ended, held, released, handed-back, refused, and holding, its sessions after each hello), only while its link is up. A runner that drives sessions says `drive` in its hello, and can take a handoff as one (mode `driven`). Their text, ids, rooms, tool names, a start's room sessions and the `holding` list are bounded by exported `MAX_*` constants, which a runner keeps its messages within; the acting person (`by`) and project ids aren't bounded, as they aren't anywhere else in the protocol.
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

MIT. Source: [`packages/protocol`](https://github.com/isoplan-app/isoplan-plugin/tree/main/packages/protocol).
