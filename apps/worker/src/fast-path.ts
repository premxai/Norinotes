import { channels, eq, profiles, type Db } from "@norinote/db";
import { readNoriPaused, readSchedule } from "@norinote/apply";
import { readTelegramSettings } from "@norinote/telegram";

/**
 * Whether Nori may prepare strong fits ahead for this person: they turned on the schedule (and did not pause it), or they
 * linked Telegram and kept its strong-fit alert on, so a strong fit is announced as soon as it is prepared. Nobody else
 * gets applications they did not start, and nobody at all while they have Nori paused.
 */
export async function actsForPerson(db: Db, userId: string): Promise<boolean> {
  const [profile] = await db.select({ preferences: profiles.preferences }).from(profiles).where(eq(profiles.userId, userId)).limit(1);
  if (readNoriPaused(profile?.preferences)) return false;
  const schedule = readSchedule(profile?.preferences);
  if (schedule.enabled && !schedule.paused) return true;
  const [channel] = await db.select({ id: channels.id }).from(channels).where(eq(channels.userId, userId)).limit(1);
  return !!channel && readTelegramSettings(profile?.preferences).events.strongFit;
}
