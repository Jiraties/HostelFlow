import type { Request, Response } from "express";
import mongoose from "mongoose";
import ExtraSaleAnnotation, {
  calendarAnnotationKinds,
  type CalendarAnnotationKind,
} from "../models/extraSaleAnnotation";
import { invalidRoomIds } from "../config/roomInventory";
import {
  RoomMutationConflictError,
  withRoomMutationLocks,
} from "../services/roomMutationLocks";

const parseDateKey = (value: unknown) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00`);
  const [year, month, day] = value.split("-").map(Number);
  return date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
    ? date
    : null;
};

export const createExtraSaleAnnotation = async (req: Request, res: Response) => {
  const createdBy = req.user?.username;
  if (!createdBy) return res.status(401).json({ message: "กรุณาเข้าสู่ระบบใหม่" });

  const roomIds = Array.isArray(req.body.roomIds)
    ? Array.from(new Set<string>(req.body.roomIds.filter(
        (value: unknown): value is string => typeof value === "string" && !!value.trim(),
      ).map((value: string) => value.trim())))
    : [];
  const from = parseDateKey(req.body.from);
  const to = parseDateKey(req.body.to);
  const kind = (req.body.kind ?? "EXTRA_SALE") as CalendarAnnotationKind;
  const customReason = typeof req.body.customReason === "string" ? req.body.customReason.trim() : "";
  const note = typeof req.body.note === "string" ? req.body.note.trim() : "";

  if (!roomIds.length || !from || !to || from >= to) {
    return res.status(400).json({ error: "INVALID_ANNOTATION_RANGE", message: "กรุณาระบุห้องและช่วงวันที่ให้ถูกต้อง" });
  }
  if (!calendarAnnotationKinds.includes(kind)) {
    return res.status(400).json({ error: "INVALID_ANNOTATION_KIND", message: "กรุณาเลือกประเภทหมายเหตุ" });
  }
  if (kind === "OTHER" && (!customReason || customReason.length > 80)) {
    return res.status(400).json({ error: "INVALID_ANNOTATION_REASON", message: "กรุณาระบุหัวข้อไม่เกิน 80 ตัวอักษร" });
  }
  if (invalidRoomIds(roomIds).length) {
    return res.status(400).json({ error: "INVALID_ROOM_ID", message: "ไม่พบห้องที่เปิดใช้งาน" });
  }
  if (note.length > 500) {
    return res.status(400).json({ error: "EXTRA_SALE_NOTE_TOO_LONG", message: "หมายเหตุต้องไม่เกิน 500 ตัวอักษร" });
  }

  try {
    const result = await withRoomMutationLocks([{ roomIds, from, to }], async () => {
      const overlapping = await ExtraSaleAnnotation.exists({
        roomIds: { $in: roomIds },
        removedAt: { $exists: false },
        from: { $lt: to },
        to: { $gt: from },
      });
      if (overlapping) return null;
      return ExtraSaleAnnotation.create({
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
  } catch (error) {
    if (error instanceof RoomMutationConflictError) {
      return res.status(409).json({ error: "ROOM_MUTATION_CONFLICT", message: "ห้องนี้กำลังถูกแก้ไข กรุณาลองอีกครั้ง" });
    }
    return res.status(500).json({ message: "ไม่สามารถทำเครื่องหมายได้" });
  }
};

export const updateExtraSaleNote = async (req: Request, res: Response) => {
  if (!req.user?.username) return res.status(401).json({ message: "กรุณาเข้าสู่ระบบใหม่" });
  if (!mongoose.isValidObjectId(req.params.annotationId)) {
    return res.status(404).json({ message: "ไม่พบหมายเหตุในปฏิทิน" });
  }
  if (typeof req.body.note !== "string" || req.body.note.trim().length > 500) {
    return res.status(400).json({ message: "หมายเหตุต้องไม่เกิน 500 ตัวอักษร" });
  }
  try {
    const annotation = await ExtraSaleAnnotation.findOneAndUpdate(
      { _id: req.params.annotationId, removedAt: { $exists: false } },
      { $set: { note: req.body.note.trim(), updatedBy: req.user.username, updatedAt: new Date() } },
      { returnDocument: "after", runValidators: true },
    );
    if (!annotation) return res.status(404).json({ message: "ไม่พบหมายเหตุในปฏิทิน" });
    return res.json({ annotation });
  } catch {
    return res.status(500).json({ message: "ไม่สามารถบันทึกหมายเหตุได้" });
  }
};

export const removeExtraSaleAnnotation = async (req: Request, res: Response) => {
  const removedBy = req.user?.username;
  if (!removedBy) return res.status(401).json({ message: "กรุณาเข้าสู่ระบบใหม่" });
  if (!mongoose.isValidObjectId(req.params.annotationId)) {
    return res.status(404).json({ message: "ไม่พบหมายเหตุในปฏิทิน" });
  }
  try {
    const annotation = await ExtraSaleAnnotation.findOneAndUpdate(
      { _id: req.params.annotationId, removedAt: { $exists: false } },
      { $set: { removedAt: new Date(), removedBy } },
      { returnDocument: "after" },
    );
    if (!annotation) return res.status(404).json({ message: "ไม่พบหมายเหตุในปฏิทิน" });
    return res.json({ annotation });
  } catch {
    return res.status(500).json({ message: "ไม่สามารถลบหมายเหตุได้" });
  }
};
