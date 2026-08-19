import { cookies } from "next/headers";
import {
  parseUserContactMarks,
  USER_CONTACT_MARKS_COOKIE_NAME,
} from "./user-contact-marks";

export async function getContactedUserIds() {
  const jar = await cookies();
  return parseUserContactMarks(
    jar.get(USER_CONTACT_MARKS_COOKIE_NAME)?.value,
  );
}
