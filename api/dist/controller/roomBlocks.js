"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.releaseRoomBlock = exports.createRoomBlock = void 0;
const booking_1 = __importDefault(require("../models/booking"));
const roomBlock_1 = __importDefault(require("../models/roomBlock"));
const roomInventory_1 = require("../config/roomInventory");
const roomMutationLocks_1 = require("../services/roomMutationLocks");
const roomBlockAvailability_1 = require("../services/roomBlockAvailability");
const activityServices_1 = require("../services/activityServices");
const roomStayHelpers_1 = require("../helpers/roomStayHelpers");
const ROOM_BLOCKING_BOOKING_FILTER = {
    voided: { $ne: true },
    $or: [
        { status: { $nin: ["cancelled", "checkedOut", "noShow"] } },
        { "cancellation.roomReleaseStatus": "blocked" },
        { "checkout.roomReleaseStatus": "blocked" },
        { "resolution.roomReleaseStatus": "blocked" },
    ],
};
const parseDateKey = (value) => {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return null;
    }
    const date = new Date(`${value}T00:00:00`);
    const [year, month, day] = value.split("-").map(Number);
    if (Number.isNaN(date.getTime()) ||
        date.getFullYear() !== year ||
        date.getMonth() !== month - 1 ||
        date.getDate() !== day) {
        return null;
    }
    return date;
};
const overlappingBooking = (roomIds, from, to) => booking_1.default.findOne({
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
const createRoomBlock = async (req, res) => {
    try {
        const createdBy = req.user?.username;
        if (!createdBy) {
            return res.status(401).json({ message: "กรุณาเข้าสู่ระบบใหม่" });
        }
        const requestedRoomIds = Array.isArray(req.body.roomIds)
            ? req.body.roomIds
                .map((roomId) => String(roomId).trim())
                .filter(Boolean)
            : typeof req.body.roomId === "string" && req.body.roomId.trim()
                ? [req.body.roomId.trim()]
                : [];
        const roomIds = Array.from(new Set(requestedRoomIds));
        const reason = typeof req.body.reason === "string" ? req.body.reason.trim() : "";
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
        const invalidRooms = (0, roomInventory_1.invalidRoomIds)(roomIds);
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
        const result = await (0, roomMutationLocks_1.withRoomMutationLocks)([{ roomIds, from, to }], async () => {
            if (await overlappingBooking(roomIds, from, to)) {
                return { conflict: "booking" };
            }
            if (await (0, roomBlockAvailability_1.findActiveRoomBlockConflict)([{ roomIds, from, to }])) {
                return { conflict: "block" };
            }
            const block = await roomBlock_1.default.create({
                roomIds,
                from,
                to,
                reason,
                createdBy,
            });
            return { block };
        });
        if (result.conflict) {
            return res.status(409).json({
                error: "ROOM_CONFLICT",
                message: result.conflict === "booking"
                    ? "ห้องนี้มี Booking อยู่ในช่วงวันที่เลือก"
                    : "ห้องนี้ถูกบล็อกอยู่ในช่วงวันที่เลือก",
            });
        }
        const block = result.block;
        await (0, activityServices_1.logActivity)(createdBy, "CREATE_ROOM_BLOCK", {
            snapshot: {
                blockId: String(block._id),
                roomIds,
                from,
                to,
                reason,
            },
        });
        return res.status(201).json({
            message: "บล็อกห้องสำเร็จ",
            block,
        });
    }
    catch (err) {
        if (err instanceof roomMutationLocks_1.RoomMutationConflictError) {
            return res.status(409).json({
                error: "ROOM_MUTATION_CONFLICT",
                message: "ห้องนี้กำลังถูกแก้ไขโดยผู้ใช้อื่น กรุณาลองอีกครั้ง",
            });
        }
        return res.status(500).json({ message: "ไม่สามารถบล็อกห้องได้" });
    }
};
exports.createRoomBlock = createRoomBlock;
const releaseRoomBlock = async (req, res) => {
    try {
        const releasedBy = req.user?.username;
        if (!releasedBy) {
            return res.status(401).json({ message: "กรุณาเข้าสู่ระบบใหม่" });
        }
        const current = await roomBlock_1.default.findById(req.params.blockId);
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
        const block = await roomBlock_1.default.findOneAndUpdate({ _id: current._id, releasedAt: { $exists: false } }, { $set: { releasedAt: new Date(), releasedBy } }, { returnDocument: "after", runValidators: true });
        if (!block) {
            const latest = await roomBlock_1.default.findById(current._id);
            return res.status(200).json({
                message: "ห้องนี้ถูกเปิดให้จองแล้ว",
                block: latest,
            });
        }
        await (0, activityServices_1.logActivity)(releasedBy, "RELEASE_ROOM_BLOCK", {
            summary: {
                blockId: String(block._id),
                roomIds: (0, roomStayHelpers_1.getRoomStayRoomIds)(block),
                from: block.from,
                to: block.to,
                reason: block.reason,
            },
        });
        return res.status(200).json({
            message: "เปิดห้องให้จองแล้ว",
            block,
        });
    }
    catch (err) {
        return res.status(500).json({ message: "ไม่สามารถเปิดห้องให้จองได้" });
    }
};
exports.releaseRoomBlock = releaseRoomBlock;
//# sourceMappingURL=roomBlocks.js.map