import { API_URL } from "../config/api";

const DEFAULT_PROFILE_PICTURE_PATH = "/uploads/default.jpg";
const ABSOLUTE_IMAGE_URL = /^(?:https?:|data:|blob:)/i;

export const profilePictureUrl = (value?: string | null) => {
  const imagePath = value?.trim() || DEFAULT_PROFILE_PICTURE_PATH;

  if (ABSOLUTE_IMAGE_URL.test(imagePath)) return imagePath;

  return `${API_URL}${imagePath.startsWith("/") ? "" : "/"}${imagePath}`;
};
