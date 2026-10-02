"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.removeExtraSaleAnnotation = exports.updateExtraSaleNote = exports.createExtraSaleAnnotation = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
const extraSaleAnnotation_1 = __importStar(require("../models/extraSaleAnnotation"));
const roomInventory_1 = require("../config/roomInventory");
const roomMutationLocks_1 = require("../services/roomMutationLocks");
const parseDateKey = (value) => {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
        return null;
    const date = new Date(`${value}T00:00:00`);
    const [year, month, day] = value.split("-").map(Number);
    return date.getFullYear() === year &&
        date.getMonth() === month - 1 &&
        date.getDate() === day
        ? date
        : null;
};
const createExtraSaleAnnotation = async (req, res) => {
    const createdBy = req.user?.username;
    if (!createdBy)
        return res.status(401).json({ message: "กรุณาเข้าสู่ระบบใหม่" });
    const roomIds = Array.isArray(req.body.roomIds)
        ? Array.from(new Set(req.body.roomIds.filter((value) => typeof value === "string" && !!value.trim()).map((value) => value.trim())))
        : [];
    const from = parseDateKey(req.body.from);
    const to = parseDateKey(req.body.to);
    const kind = (req.body.kind ?? "EXTRA_SALE");
    const customReason = typeof req.body.customReason === "string" ? req.body.customReason.trim() : "";
    const note = typeof req.body.note === "string" ? req.body.note.trim() : "";
    if (!roomIds.length || !from || !to || from >= to) {
        return res.status(400).json({ error: "INVALID_ANNOTATION_RANGE", message: "กรุณาระบุห้องและช่วงวันที่ให้ถูกต้อง" });
    }
    if (!extraSaleAnnotation_1.calendarAnnotationKinds.includes(kind)) {
        return res.status(400).json({ error: "INVALID_ANNOTATION_KIND", message: "กรุณาเลือกประเภทหมายเหตุ" });
    }
    if (kind === "OTHER" && (!customReason || customReason.length > 80)) {
        return res.status(400).json({ error: "INVALID_ANNOTATION_REASON", message: "กรุณาระบุหัวข้อไม่เกิน 80 ตัวอักษร" });
    }
    if ((0, roomInventory_1.invalidRoomIds)(roomIds).length) {
        return res.status(400).json({ error: "INVALID_ROOM_ID", message: "ไม่พบห้องที่เปิดใช้งาน" });
    }
    if (note.length > 500) {
        return res.status(400).json({ error: "EXTRA_SALE_NOTE_TOO_LONG", message: "หมายเหตุต้องไม่เกิน 500 ตัวอักษร" });
    }
    try {
        const result = await (0, roomMutationLocks_1.withRoomMutationLocks)([{ roomIds, from, to }], async () => {
            const overlapping = await extraSaleAnnotation_1.default.exists({
                roomIds: { $in: roomIds },
                removedAt: { $exists: false },
                from: { $lt: to },
                to: { $gt: from },
            });
            if (overlapping)
                return null;
            return extraSaleAnnotation_1.default.create({
                roomIds,
                from,
                to,
                kind,
                customReason: kind === "OTHER" ? customReason : "",
                note,
                createdBy,
            });
        });
        if (!result) {
            return res.status(409).json({ error: "ANNOTATION_OVERLAP", message: "ช่วงวันที่นี้มีหมายเหตุของห้องที่เลือกอยู่แล้ว" });
        }
        return res.status(201).json({ annotation: result });
    }
    catch (error) {
        if (error instanceof roomMutationLocks_1.RoomMutationConflictError) {
            return res.status(409).json({ error: "ROOM_MUTATION_CONFLICT", message: "ห้องนี้กำลังถูกแก้ไข กรุณาลองอีกครั้ง" });
        }
        return res.status(500).json({ message: "ไม่สามารถทำเครื่องหมายได้" });
    }
};
exports.createExtraSaleAnnotation = createExtraSaleAnnotation;
const updateExtraSaleNote = async (req, res) => {
    if (!req.user?.username)
        return res.status(401).json({ message: "กรุณาเข้าสู่ระบบใหม่" });
    if (!mongoose_1.default.isValidObjectId(req.params.annotationId)) {
        return res.status(404).json({ message: "ไม่พบหมายเหตุในปฏิทิน" });
    }
    if (typeof req.body.note !== "string" || req.body.note.trim().length > 500) {
        return res.status(400).json({ message: "หมายเหตุต้องไม่เกิน 500 ตัวอักษร" });
    }
    try {
        const annotation = await extraSaleAnnotation_1.default.findOneAndUpdate({ _id: req.params.annotationId, removedAt: { $exists: false } }, { $set: { note: req.body.note.trim(), updatedBy: req.user.username, updatedAt: new Date() } }, { returnDocument: "after", runValidators: true });
        if (!annotation)
            return res.status(404).json({ message: "ไม่พบหมายเหตุในปฏิทิน" });
        return res.json({ annotation });
    }
    catch {
        return res.status(500).json({ message: "ไม่สามารถบันทึกหมายเหตุได้" });
    }
};
exports.updateExtraSaleNote = updateExtraSaleNote;
const removeExtraSaleAnnotation = async (req, res) => {
    const removedBy = req.user?.username;
    if (!removedBy)
        return res.status(401).json({ message: "กรุณาเข้าสู่ระบบใหม่" });
    if (!mongoose_1.default.isValidObjectId(req.params.annotationId)) {
        return res.status(404).json({ message: "ไม่พบหมายเหตุในปฏิทิน" });
    }
    try {
        const annotation = await extraSaleAnnotation_1.default.findOneAndUpdate({ _id: req.params.annotationId, removedAt: { $exists: false } }, { $set: { removedAt: new Date(), removedBy } }, { returnDocument: "after" });
        if (!annotation)
            return res.status(404).json({ message: "ไม่พบหมายเหตุในปฏิทิน" });
        return res.json({ annotation });
    }
    catch {
        return res.status(500).json({ message: "ไม่สามารถลบหมายเหตุได้" });
    }
};
exports.removeExtraSaleAnnotation = removeExtraSaleAnnotation;
//# sourceMappingURL=extraSaleAnnotations.js.map