type BuildEnvironment = Record<string, string | undefined>;

export function workersBuildRsvpStore(
  environment: BuildEnvironment,
): string | undefined {
  if (environment.PUBLIC_RSVP_STORE !== undefined) {
    return environment.PUBLIC_RSVP_STORE;
  }

  if (
    environment.WORKERS_CI === "1" &&
    environment.WORKERS_CI_BRANCH !== undefined &&
    environment.WORKERS_CI_BRANCH !== "main"
  ) {
    return "fake";
  }

  return undefined;
}
