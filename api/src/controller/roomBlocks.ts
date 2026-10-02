import type { Request, Response } from "express";
import Booking from "../models/booking";
import RoomBlock, {
  HOUSE_USE_ROOM_BLOCK_REASON,
  ROOM_BLOCK_REASON_TYPES,
  type RoomBlockReasonType,
} from "../models/roomBlock";
import { invalidRoomIds } from "../config/roomInventory";
import {
  RoomMutationConflictError,
  withRoomMutationLocks,
} from "../services/roomMutationLocks";
import { findActiveRoomBlockConflict } from "../services/roomBlockAvailability";
import { logActivity } from "../services/activityServices";
import { getRoomStayRoomIds } from "../helpers/roomStayHelpers";

const ROOM_BLOCKING_BOOKING_FILTER = {
  voided: { $ne: true },
  $or: [
    { status: { $nin: ["cancelled", "checkedOut", "noShow"] } },
    { "cancellation.roomReleaseStatus": "blocked" },
    { "checkout.roomReleaseStatus": "blocked" },
    { "resolution.roomReleaseStatus": "blocked" },
  ],
};

const parseDateKey = (value: unknown) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const date = new Date(`${value}T00:00:00`);
  const [year, month, day] = value.split("-").map(Number);
  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
};

const overlappingBooking = (roomIds: string[], from: Date, to: Date) =>
  Booking.findOne({
    $and: [
      ROOM_BLOCKING_BOOKING_FILTER,
      {
        $or: [
          {
            roomStays: {
              $elemMatch: {
                roomIds: { $in: roomIds },
                from: { $lt: to },
                to: { $gt: from },
              },
            },
          },
          {
            roomStays: {
              $elemMatch: {
                roomId: { $in: roomIds },
                from: { $lt: to },
                to: { $gt: from },
              },
            },
          },
        ],
      },
    ],
  }).lean();

export const createRoomBlock = async (req: Request, res: Response) => {
  try {
    const createdBy = req.user?.username;
    if (!createdBy) {
      return res.status(401).json({ message: "กรุณาเข้าสู่ระบบใหม่" });
    }

    const requestedRoomIds: string[] = Array.isArray(req.body.roomIds)
      ? req.body.roomIds
          .map((roomId: unknown) => String(roomId).trim())
          .filter(Boolean)
      : typeof req.body.roomId === "string" && req.body.roomId.trim()
        ? [req.body.roomId.trim()]
        : [];
    const roomIds: string[] = Array.from(new Set<string>(requestedRoomIds));
    const reason = typeof req.body.reason === "string" ? req.body.reason.trim() : "";
    if (
      req.body.reasonType !== undefined &&
      !ROOM_BLOCK_REASON_TYPES.includes(req.body.reasonType)
    ) {
      return res.status(400).json({
        error: "INVALID_ROOM_BLOCK_REASON_TYPE",
        message: "กรุณาเลือกประเภทการบล็อกห้องที่ถูกต้อง",
      });
    }
    const reasonType: RoomBlockReasonType = req.body.reasonType ??
      (reason === HOUSE_USE_ROOM_BLOCK_REASON ? "house_use" : "other");
    const from = parseDateKey(req.body.from);
    const to = parseDateKey(req.body.to);

    if (!roomIds.length || !from || !to || !reason) {
      return res.status(400).json({
        error: "INVALID_ROOM_BLOCK",
        message: "กรุณาระบุห้อง วันที่ และเหตุผลที่บล็อก",
      });
    }
    if (reason.length > 500) {
      return res.status(400).json({
        error: "ROOM_BLOCK_REASON_TOO_LONG",
        message: "เหตุผลต้องไม่เกิน 500 ตัวอักษร",
      });
    }
    const invalidRooms = invalidRoomIds(roomIds);
    if (invalidRooms.length) {
      return res.status(400).json({
        error: "INVALID_ROOM_ID",
        message: `ไม่พบห้องที่เปิดใช้งาน: ${invalidRooms.join(", ")}`,
      });
    }
    if (from >= to) {
      return res.status(400).json({
        error: "INVALID_ROOM_BLOCK_RANGE",
        message: "วันสิ้นสุดต้องอยู่หลังวันเริ่มต้น",
      });
    }

    const result: {
      conflict?: "booking" | "block";
      block?: InstanceType<typeof RoomBlock>;
    } = await withRoomMutationLocks(
      [{ roomIds, from, to }],
      async () => {
        if (await overlappingBooking(roomIds, from, to)) {
          return { conflict: "booking" as const };
        }
        if (await findActiveRoomBlockConflict([{ roomIds, from, to }])) {
          return { conflict: "block" as const };
        }

        const block = await RoomBlock.create({
          roomIds,
          from,
          to,
          reason,
          reasonType,
          createdBy,
        });
        return { block };
      },
    );

    if (result.conflict) {
      return res.status(409).json({
        error: "ROOM_CONFLICT",
        message:
          result.conflict === "booking"
            ? "ห้องนี้มี Booking อยู่ในช่วงวันที่เลือก"
            : "ห้องนี้ถูกบล็อกอยู่ในช่วงวันที่เลือก",
      });
    }

    const block = result.block!;
    await logActivity(createdBy, "CREATE_ROOM_BLOCK", {
      snapshot: {
        blockId: String(block._id),
        roomIds,
        from,
        to,
        reason,
        reasonType,
      },
    });
    return res.status(201).json({
      message: "บล็อกห้องสำเร็จ",
      block,
    });
  } catch (err) {
    if (err instanceof RoomMutationConflictError) {
      return res.status(409).json({
        error: "ROOM_MUTATION_CONFLICT",
        message: "ห้องนี้กำลังถูกแก้ไขโดยผู้ใช้อื่น กรุณาลองอีกครั้ง",
      });
    }
    return res.status(500).json({ message: "ไม่สามารถบล็อกห้องได้" });
  }
};

export const releaseRoomBlock = async (req: Request, res: Response) => {
  try {
    const releasedBy = req.user?.username;
    if (!releasedBy) {
      return res.status(401).json({ message: "กรุณาเข้าสู่ระบบใหม่" });
    }

    const current = await RoomBlock.findById(req.params.blockId);
    if (!current) {
      return res.status(404).json({
        error: "ROOM_BLOCK_NOT_FOUND",
        message: "ไม่พบรายการบล็อกห้องนี้",
      });
    }
    if (current.releasedAt) {
      return res.status(200).json({
        message: "ห้องนี้ถูกเปิดให้จองแล้ว",
        block: current,
      });
    }

    const block = await RoomBlock.findOneAndUpdate(
      { _id: current._id, releasedAt: { $exists: false } },
      { $set: { releasedAt: new Date(), releasedBy } },
      { returnDocument: "after", runValidators: true },
    );
    if (!block) {
      const latest = await RoomBlock.findById(current._id);
      return res.status(200).json({
        message: "ห้องนี้ถูกเปิดให้จองแล้ว",
        block: latest,
      });
    }

    await logActivity(releasedBy, "RELEASE_ROOM_BLOCK", {
      summary: {
        blockId: String(block._id),
        roomIds: getRoomStayRoomIds(block),
        from: block.from,
        to: block.to,
        reason: block.reason,
        reasonType: block.reasonType,
      },
    });
    return res.status(200).json({
      message: "เปิดห้องให้จองแล้ว",
      block,
    });
  } catch (err) {
    return res.status(500).json({ message: "ไม่สามารถเปิดห้องให้จองได้" });
  }
};
