import crypto from "crypto";
import type { NamePrefix } from "../models/booking";
import {
  formatDestinationCountryForReport,
  isThaiNationality,
  splitPassportName,
} from "../helpers/passportHelpers";

const FOREIGN_NAME_PREFIXES: NamePrefix[] = ["Mr", "Mrs", "Ms", "Miss", "Dr"];
const THAI_NAME_PREFIXES: NamePrefix[] = [
  "นาย",
  "นาง",
  "นางสาว",
  "เด็กชาย",
  "เด็กหญิง",
];

export type PassportInput = {
  namePrefix: NamePrefix;
  passportNo: string;
  passportName: string;
  nationality: string;
  nextDestinationCountry: string;
};

export class PassportDataError extends Error {
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = "PassportDataError";
  }
}

const encrypt = (text: string) => {
  if (!process.env.CRYPTO_SECRET) throw new Error("CRYPTO_SECRET Missing");

  const key = Buffer.from(process.env.CRYPTO_SECRET, "hex");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  let cipherText = cipher.update(text, "utf8", "hex");
  cipherText += cipher.final("hex");

  return {
    iv: iv.toString("hex"),
    cipherText,
    authTag: cipher.getAuthTag().toString("hex"),
  };
};

export const validatePassportData = (input?: PassportInput) => {
  if (
    !input?.namePrefix ||
    !input.nationality?.trim() ||
    !input.nextDestinationCountry?.trim() ||
    !input.passportNo?.trim() ||
    !input.passportName?.trim()
  ) {
    throw new PassportDataError("กรุณากรอกข้อมูล Passport ให้ครบทุกช่อง");
  }

  const nationality = input.nationality.trim();
  const passportNo = input.passportNo.trim();
  const passportName = input.passportName.trim();
  const thaiGuest = isThaiNationality(nationality);
  const allowedPrefixes = thaiGuest
    ? THAI_NAME_PREFIXES
    : FOREIGN_NAME_PREFIXES;

  if (!allowedPrefixes.includes(input.namePrefix)) {
    throw new PassportDataError(
      thaiGuest
        ? "กรุณาเลือกคำนำหน้าชื่อภาษาไทย"
        : "กรุณาเลือกคำนำหน้าชื่อภาษาอังกฤษ",
    );
  }

  if (thaiGuest) {
    const thaiName = splitPassportName(passportName);
    if (!thaiName.firstName || !thaiName.lastName) {
      throw new PassportDataError("กรุณากรอกชื่อและนามสกุลภาษาไทย");
    }
    if (!/^\d{13}$/.test(passportNo)) {
      throw new PassportDataError("เลขประจำตัวประชาชนต้องเป็นตัวเลข 13 หลัก");
    }
  }

  const destination = formatDestinationCountryForReport(
    input.nextDestinationCountry.trim(),
  );
  if (!destination) {
    throw new PassportDataError("ประเทศปลายทางถัดไปไม่รองรับในรายงาน รร.");
  }

  return {
    namePrefix: input.namePrefix,
    nationality,
    nextDestinationCountry: destination.value,
    passportNo,
    passportName,
  };
};

export const validateAndEncryptPassportData = (input?: PassportInput) => {
  const normalized = validatePassportData(input);

  return {
    passportHash: crypto
      .createHash("sha256")
      .update(normalized.passportNo)
      .digest("hex"),
    namePrefix: normalized.namePrefix,
    nationality: normalized.nationality,
    nextDestinationCountry: normalized.nextDestinationCountry,
    passportNo: encrypt(normalized.passportNo),
    passportName: encrypt(normalized.passportName),
  };
};
