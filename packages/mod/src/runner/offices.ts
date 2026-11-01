// The worker's links, one to each office server in config.json (#105), and when the worker ends.
// Each office's link answers for that office alone. A server that doesn't want this machine's runner
// has its link closed, and opened again after `holdOffMs`; one that says the machine's pairing has
// ended has its link closed until the machine holds a credential for it again (a session's data
// layer pairs it). The worker never ends while a fork or take is still running: it ends once no
// office's link is left, or no room on the machine is lit, and only once everything is idle. It ends
// at once, though, when its supervisor has gone, since its forks end with it.
//
// What a runner sends while its office's link is closed is kept, at most OUTBOX_MAX, and sent once
// the link is open again, unless it is older than OUTBOX_MAX_AGE_MS by then, counted from when the
// runner first sent it, which the link goes on counting from; what is left when the worker ends is
// dropped, and the log says how much.

/** At most this many of an office's replies are kept while its link is closed; past that the oldest is dropped. */
export const OUTBOX_MAX = 100;
/** A reply kept longer than this is dropped: the server will have asked again by then. */
export const OUTBOX_MAX_AGE_MS = 3600000;

export interface OfficeLink<M> {
  /** `at`: when the runner first sent it. */
  send(message: M, at?: number): void;
  close(): void;
}

export interface AnswerOfficesOptions<O, M> {
  offices: readonly O[];
  /** The office's address, for the log. */
  name(office: O): string;
  /** Opens a link to the office; `said` is told when the server doesn't want the runner, or the pairing has ended. */
  open(office: O, said: { notWanted(): void; unpaired(): void }): OfficeLink<M>;
  /** Whether the machine holds a credential for the office again. */
  paired(office: O): Promise<boolean>;
  /** Whether every office's runner is idle: nothing queued, forking or being taken. */
  idle(): boolean;
  /** Whether any room on the machine is still lit. */
  lit(): Promise<boolean>;
  /** Resolves when the supervisor has gone. */
  gone: Promise<void>;
  log(text: string): void;
  checkMs: number;
  holdOffMs: number;
  now?: () => number;
}

/** Why the worker ended. */
export type Ended = "done" | "not-wanted" | "unpaired" | "orphaned";

export interface AnsweringOffices<M> {
  /** What the office's runner sends: on its link, or kept until the link is open again. */
  sender(index: number): (message: M) => void;
  ended: Promise<Ended>;
}

export function answerOffices<O, M>(o: AnswerOfficesOptions<O, M>): AnsweringOffices<M> {
  const now = o.now ?? Date.now;
  let wake: () => void = () => {};
  const states = o.offices.map(() => ({ link: null as OfficeLink<M> | null, notWanted: false, unpaired: false, closedAt: 0, outbox: [] as { message: M; at: number }[] }));
  const start = (i: number) => {
    const s = states[i]!;
    s.notWanted = s.unpaired = false;
    s.link = o.open(o.offices[i]!, {
      notWanted: () => ((s.notWanted = true), wake()),
      unpaired: () => ((s.unpaired = true), wake()),
    });
    const kept = s.outbox.splice(0);
    const fresh = kept.filter((m) => now() - m.at < OUTBOX_MAX_AGE_MS);
    if (fresh.length < kept.length) o.log(`dropped ${kept.length - fresh.length} of the runner's replies for ${o.name(o.offices[i]!)}: they waited for its link longer than ${OUTBOX_MAX_AGE_MS / 60000} minutes`);
    for (const { message, at } of fresh) s.link.send(message, at);
  };
  let orphaned = false;
  void o.gone.then(() => ((orphaned = true), wake()));

  async function run(): Promise<Ended> {
    o.offices.forEach((_, i) => start(i));
    for (;;) {
      if (!orphaned) await new Promise<void>((r) => ((wake = r), setTimeout(r, o.checkMs)));
      if (orphaned) return "orphaned";
      for (const [i, s] of states.entries()) {
        const office = o.offices[i]!;
        if (s.link && (s.notWanted || s.unpaired)) {
          o.log(`the runner stopped answering through ${o.name(office)}: ${s.notWanted ? `it doesn't want this machine's runner; asking again in ${o.holdOffMs / 60000} minutes` : "it says this machine's pairing has ended; answering again once it is paired"}`);
          s.link.close();
          s.link = null;
          s.closedAt = now();
        } else if (!s.link && (s.notWanted ? now() - s.closedAt >= o.holdOffMs : await o.paired(office))) {
          o.log(`the runner is answering through ${o.name(office)} again`);
          start(i);
        }
      }
      if (!o.idle()) continue;
      if (!states.some((s) => s.link)) return states.some((s) => s.notWanted) ? "not-wanted" : "unpaired";
      if (!(await o.lit())) return "done";
    }
  }

  const ended = run().finally(() => {
    for (const [i, s] of states.entries()) {
      s.link?.close();
      if (s.outbox.length) o.log(`dropped ${s.outbox.length} of the runner's replies for ${o.name(o.offices[i]!)}: its link was closed when the runner ended`);
    }
  });
  return {
    sender: (i) => (message) => {
      const s = states[i]!;
      if (s.link) return s.link.send(message);
      s.outbox.push({ message, at: now() });
      if (s.outbox.length > OUTBOX_MAX) {
        s.outbox.shift();
        o.log(`dropped the oldest of the runner's replies for ${o.name(o.offices[i]!)}: more than ${OUTBOX_MAX} waited for its link`);
      }
    },
    ended,
  };
}
