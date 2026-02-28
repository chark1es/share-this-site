import { cronJobs } from "convex/server";

import { api } from "./_generated/api";

const crons = cronJobs();

crons.daily(
  "purge-expired-links",
  {
    hourUTC: 8,
    minuteUTC: 0,
  },
  api.links.purgeExpiredLinks,
);

export default crons;
