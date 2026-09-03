"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getActiveBlockedRoomIds = exports.findActiveRoomBlockConflict = void 0;
const roomBlock_1 = __importDefault(require("../models/roomBlock"));
const roomStayHelpers_1 = require("../helpers/roomStayHelpers");
const activeRoomBlockQuery = (ranges) => ({
    releasedAt: { $exists: false },
    $or: ranges.map((range) => {
        const roomIds = (0, roomStayHelpers_1.getRoomStayRoomIds)(range);
        return {
            $and: [
                {
                    $or: [
                        { roomIds: { $in: roomIds } },
                        { roomId: { $in: roomIds } },
                    ],
                },
                {
                    from: { $lt: new Date(range.to) },
                    to: { $gt: new Date(range.from) },
                },
            ],
        };
    }),
});
const findActiveRoomBlockConflict = async (ranges, session) => {
    if (!ranges.length)
        return null;
    const query = roomBlock_1.default.findOne(activeRoomBlockQuery(ranges));
    if (session)
        query.session(session);
    return query.lean();
};
exports.findActiveRoomBlockConflict = findActiveRoomBlockConflict;
const getActiveBlockedRoomIds = async (from, to) => {
    const blocks = await roomBlock_1.default.find({
        releasedAt: { $exists: false },
        from: { $lt: to },
        to: { $gt: from },
    })
        .select("roomId roomIds")
        .lean();
    return Array.from(new Set(blocks.flatMap((block) => (0, roomStayHelpers_1.getRoomStayRoomIds)(block))));
};
exports.getActiveBlockedRoomIds = getActiveBlockedRoomIds;
//# sourceMappingURL=roomBlockAvailability.js.map