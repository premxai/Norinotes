import { channels, eq, profiles, type Db } from "@norinote/db";
import { readSchedule } from "@norinote/apply";

/**
 * Whether Nori may prepare strong fits ahead for this person: they turned on the schedule (and did not pause it), or they
 * linked Telegram, where a strong fit is announced as soon as it is prepared. Nobody else gets applications they did not
 * start.
 */
export async function actsForPerson(db: Db, userId: string): Promise<boolean> {
  const [profile] = await db.select({ preferences: profiles.preferences }).from(profiles).where(eq(profiles.userId, userId)).limit(1);
  const schedule = readSchedule(profile?.preferences);
  if (schedule.enabled && !schedule.paused) return true;
  const [channel] = await db.select({ id: channels.id }).from(channels).where(eq(channels.userId, userId)).limit(1);
  return !!channel;
}
