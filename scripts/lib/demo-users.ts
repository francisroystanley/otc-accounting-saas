// Demo account credentials seeded by `npm run seed`. These are intentionally
// checked in — the reviewer gets them out-of-band per R27 (emailed with the
// prod URL, repo link, and Loom). The `populated` account is pre-filled with
// extracted fixture documents; the `empty` account proves R3 workspace
// isolation by showing zero rows when the reviewer logs in.
export type DemoUserLabel = "populated" | "empty";

export type DemoUser = {
  label: DemoUserLabel;
  email: string;
  password: string;
};

export const DEMO_USERS: readonly DemoUser[] = [
  {
    label: "populated",
    email: "demo-populated@otc-accounting.local",
    password: "OtcDemo2026!Populated",
  },
  {
    label: "empty",
    email: "demo-empty@otc-accounting.local",
    password: "OtcDemo2026!Empty",
  },
] as const;
