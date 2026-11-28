// Designed tolerances, targets and seed ranges for M4 milestones A and B (docs/specs/
// m4-franchise-core.md, open question 10, accepted as written by the lead on 2026-11-23; the
// 2026-11-24 block is the spec's revision of that date, written here before the first run on the
// new pool). Never tune one of these after seeing a result: tune the data, on the tuning seeds.

/** A5: the deployed mean of each rating per position against the engine's league mean, in rating points. */
export const A5_TOLERANCE = 0.5;
/** A5: seeded all-AI leagues. */
export const A5_LEAGUES = 800;

/** A6 (needs the schedule and the season sim, milestones C and E): points and turnovers per team-game. */
export const A6_POINTS_TOLERANCE = 1.0;
export const A6_TURNOVERS_TOLERANCE = 0.15;
export const A6_FRANCHISE_SEASONS = 20;
export const A6_BASELINE_GAMES = 5440;

/** B10: a full all-AI draft, in milliseconds, on Joseph's machine. */
export const B10_BUDGET_MS = 250;

/** A5: the leagues are franchise seeds A5_FIRST_SEED to A5_FIRST_SEED + A5_LEAGUES - 1, fixed before the first full run. */
export const A5_FIRST_SEED = 1;

// ---------------------------------------------------------------- revision 2026-11-24

/** Every number in data/franchise was tuned on these franchise seeds only. No check below reads one of them. */
export const TUNING_FIRST_SEED = 100001;
export const TUNING_LEAGUES = 800;

/** A6a: franchise seeds 1 to 20 and quick-play league seeds 1 to 20, 272 games each, with A6's tolerances, standouts off and on. */
export const A6A_FIRST_SEED = 1;
export const A6A_LEAGUES = 20;
export const A6A_GAMES_PER_LEAGUE = 272;

/** A10: the deployed SD of each rating against quick play's (a share of it), and each standout kind's mean applied factor against 1. */
export const A10_SD_TOLERANCE = 0.15;
export const A10_FACTOR_TOLERANCE = 0.02;

/** A11, per position with target above min: the starter to first-backup gap, the mean overall at the target slot, and the share of first backups at or above the starters' 10th percentile. */
export const A11_GAP_MIN = 2;
export const A11_GAP_MAX = 15;
export const A11_TARGET_SLOT_OVERALL_MIN = 40;
export const A11_OVERLAP_PERCENTILE = 0.1;
export const A11_OVERLAP_SHARE_MIN = 0.05;

/** B13, over seeds 1 to 200. */
export const B13_FIRST_SEED = 1;
export const B13_LEAGUES = 200;
export const B13_ROUND_MEAN_SHARE_MAX = 0.5;
export const B13_SINGLE_ROUND_SHARE_MAX = 0.75;
export const B13_EARLY_ROUNDS = 33;
export const B13_EARLY_DEPTH_SHARE_MIN = 0.1;

/** B14 (reported, not gated), seeds 1 to 200: the drafted spread as a share of quick play's. */
export const B14_FIRST_SEED = 1;
export const B14_LEAGUES = 200;
export const B14_RATIO_MIN = 0.75;
export const B14_RATIO_MAX = 1.25;

/** B16 (reported, not gated). */
export const B16_FIRST_SEED = 1;
export const B16_LEAGUES = 200;

// ---------------------------------------------------------------- review fixes 2026-11-24, written before the first run

/** A11, reported beside it: a position where more than this share of teams has no first backup (who the bench figures then leave out) is flagged. */
export const A11_NO_BACKUP_SHARE_FLAG = 0.25;

// ---------------------------------------------------------------- revision 2026-11-25, written before the first run

/**
 * The report range, 2026-11-25 (lead): every check that reads franchise seeds reads 500001 and up,
 * since the earlier ranges (1 to 800, 400001 to 400800) were read while the data was set. The
 * tolerances keep their values. A5 and B17: 500001 to 500800; B13, B14, B16 and B18's slice: the
 * first 200 of them; A6a: franchise and quick-play league seeds 500001 to 500020.
 */
export const REPORT_FIRST_SEED = 500001;
export const A5_REPORT_FIRST_SEED = REPORT_FIRST_SEED;
export const A6A_REPORT_FIRST_SEED = REPORT_FIRST_SEED;
export const B13_REPORT_FIRST_SEED = REPORT_FIRST_SEED;

/** B17 (Kickers and punters, 2026-11-25), over 800 leagues of the report range. */
export const B17_FIRST_SEED = REPORT_FIRST_SEED;
export const B17_LEAGUES = 800;
/** B17: no kicker and no punter is drafted in rounds 1 to this, in any league. */
export const B17_NONE_THROUGH_ROUND = 2;
/** B17: a kicker or punter whose overall is under this is an ordinary one. */
export const B17_STANDOUT_OVERALL = 90;
/** B17: in at least B17_LEAGUE_SHARE_MIN of leagues no ordinary kicker or punter goes before this round, for the AI teams and for the user's auto-pick alike. */
export const B17_FIRST_ROUND_MIN = 12;
export const B17_LEAGUE_SHARE_MIN = 0.99;
/** B17: the share of leagues in which some team ends the draft with a second kicker or a second punter (the spec's wording), and the share of teams (the lead's brief). Both gated. */
export const B17_SECOND_LEAGUE_SHARE_MAX = 0.01;
export const B17_SECOND_TEAM_SHARE_MAX = 0.01;
/** B17: of the leagues whose pool's best kicker has an overall of B17_STANDOUT_OVERALL or more, the share in which he is drafted by this round. */
export const B17_BEST_KICKER_ROUND_MAX = 8;
export const B17_BEST_KICKER_SHARE_MIN = 0.5;

/** B18: quarterback depth over the A5 leagues of the report range: no team ends with fewer than this many quarterbacks, and at most this share of teams ends at the position's max. */
export const B18_QB_MIN = 2;
export const B18_SHORT_TEAMS_MAX = 0;
export const B18_AT_MAX_SHARE_MAX = 0.15;
