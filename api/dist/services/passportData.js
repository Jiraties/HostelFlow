"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.decryptPassportField = exports.validateAndEncryptPassportData = exports.validateAndEncryptGuestIdentityData = exports.validatePassportData = exports.validateGuestIdentityData = exports.PassportDataError = void 0;
const crypto_1 = __importDefault(require("crypto"));
const passportHelpers_1 = require("../helpers/passportHelpers");
const FOREIGN_NAME_PREFIXES = ["Mr", "Mrs", "Ms", "Miss", "Dr"];
const THAI_NAME_PREFIXES = [
    "นาย",
    "นาง",
    "นางสาว",
    "เด็กชาย",
    "เด็กหญิง",
];
class PassportDataError extends Error {
    constructor(message) {
        super(message);
        this.status = 400;
        this.name = "PassportDataError";
    }
}
exports.PassportDataError = PassportDataError;
const encrypt = (text) => {
    if (!process.env.CRYPTO_SECRET)
        throw new Error("CRYPTO_SECRET Missing");
    const key = Buffer.from(process.env.CRYPTO_SECRET, "hex");
    const iv = crypto_1.default.randomBytes(12);
    const cipher = crypto_1.default.createCipheriv("aes-256-gcm", key, iv);
    let cipherText = cipher.update(text, "utf8", "hex");
    cipherText += cipher.final("hex");
    return {
        iv: iv.toString("hex"),
        cipherText,
        authTag: cipher.getAuthTag().toString("hex"),
    };
};
const validateGuestIdentityData = (input) => {
    if (!input?.namePrefix ||
        !input.nationality?.trim() ||
        !input.passportNo?.trim() ||
        !input.passportName?.trim()) {
        throw new PassportDataError("กรุณากรอกข้อมูล Passport ให้ครบทุกช่อง");
    }
    const nationality = input.nationality.trim();
    const passportNo = input.passportNo.trim();
    const passportName = input.passportName.trim();
    const thaiGuest = (0, passportHelpers_1.isThaiNationality)(nationality);
    const allowedPrefixes = thaiGuest
        ? THAI_NAME_PREFIXES
        : FOREIGN_NAME_PREFIXES;
    if (!allowedPrefixes.includes(input.namePrefix)) {
        throw new PassportDataError(thaiGuest
            ? "กรุณาเลือกคำนำหน้าชื่อภาษาไทย"
            : "กรุณาเลือกคำนำหน้าชื่อภาษาอังกฤษ");
    }
    if (thaiGuest) {
        const thaiName = (0, passportHelpers_1.splitPassportName)(passportName);
        if (!thaiName.firstName || !thaiName.lastName) {
            throw new PassportDataError("กรุณากรอกชื่อและนามสกุลภาษาไทย");
        }
        if (!/^\d{13}$/.test(passportNo)) {
            throw new PassportDataError("เลขประจำตัวประชาชนต้องเป็นตัวเลข 13 หลัก");
        }
    }
    return {
        namePrefix: input.namePrefix,
        nationality,
        passportNo,
        passportName,
    };
};
exports.validateGuestIdentityData = validateGuestIdentityData;
const encryptNormalizedIdentityData = (normalized) => {
    return {
        passportHash: crypto_1.default
            .createHash("sha256")
            .update(normalized.passportNo)
            .digest("hex"),
        namePrefix: normalized.namePrefix,
        nationality: normalized.nationality,
        passportNo: encrypt(normalized.passportNo),
        passportName: encrypt(normalized.passportName),
    };
};
const validatePassportData = (input) => {
    const normalized = (0, exports.validateGuestIdentityData)(input);
    if (!input?.nextDestinationCountry?.trim()) {
        throw new PassportDataError("กรุณากรอกข้อมูล Passport ให้ครบทุกช่อง");
    }
    const destination = (0, passportHelpers_1.formatDestinationCountryForReport)(input.nextDestinationCountry.trim());
    if (!destination) {
        throw new PassportDataError("ประเทศปลายทางถัดไปไม่รองรับในรายงาน รร.");
    }
    return {
        ...normalized,
        nextDestinationCountry: destination.value,
    };
};
exports.validatePassportData = validatePassportData;
const validateAndEncryptGuestIdentityData = (input) => encryptNormalizedIdentityData((0, exports.validateGuestIdentityData)(input));
exports.validateAndEncryptGuestIdentityData = validateAndEncryptGuestIdentityData;
const validateAndEncryptPassportData = (input) => {
    const normalized = (0, exports.validatePassportData)(input);
    return {
        ...encryptNormalizedIdentityData(normalized),
        nextDestinationCountry: normalized.nextDestinationCountry,
    };
};
exports.validateAndEncryptPassportData = validateAndEncryptPassportData;
const decryptPassportField = ({ cipherText, iv, authTag, }) => {
    if (!process.env.CRYPTO_SECRET)
        throw new Error("CRYPTO_SECRET Missing");
    const key = Buffer.from(process.env.CRYPTO_SECRET, "hex");
    const decipher = crypto_1.default.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "hex"));
    decipher.setAuthTag(Buffer.from(authTag, "hex"));
    let decrypted = decipher.update(cipherText, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
};
exports.decryptPassportField = decryptPassportField;
//# sourceMappingURL=passportData.js.map