"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateAndEncryptPassportData = exports.validatePassportData = exports.PassportDataError = void 0;
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
const validatePassportData = (input) => {
    if (!input?.namePrefix ||
        !input.nationality?.trim() ||
        !input.nextDestinationCountry?.trim() ||
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
    const destination = (0, passportHelpers_1.formatDestinationCountryForReport)(input.nextDestinationCountry.trim());
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
exports.validatePassportData = validatePassportData;
const validateAndEncryptPassportData = (input) => {
    const normalized = (0, exports.validatePassportData)(input);
    return {
        passportHash: crypto_1.default
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
exports.validateAndEncryptPassportData = validateAndEncryptPassportData;
//# sourceMappingURL=passportData.js.map