"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getUniqueRoomIdsFromRoomStays = exports.normalizeRoomStay = exports.formatRoomStayRooms = exports.getPrimaryRoomId = exports.getRoomStayRoomIds = void 0;
const getRoomStayRoomIds = (roomStay) => {
    const roomIds = Array.isArray(roomStay.roomIds)
        ? roomStay.roomIds
        : roomStay.roomId
            ? [roomStay.roomId]
            : [];
    return Array.from(new Set(roomIds.map((roomId) => roomId.trim()).filter(Boolean)));
};
exports.getRoomStayRoomIds = getRoomStayRoomIds;
const getPrimaryRoomId = (roomStay) => (0, exports.getRoomStayRoomIds)(roomStay)[0] || "";
exports.getPrimaryRoomId = getPrimaryRoomId;
const formatRoomStayRooms = (roomStay) => (0, exports.getRoomStayRoomIds)(roomStay).join(", ");
exports.formatRoomStayRooms = formatRoomStayRooms;
const normalizeRoomStay = (roomStay) => ({
    ...roomStay,
    roomIds: (0, exports.getRoomStayRoomIds)(roomStay),
});
exports.normalizeRoomStay = normalizeRoomStay;
const getUniqueRoomIdsFromRoomStays = (roomStays) => Array.from(new Set(roomStays.flatMap(exports.getRoomStayRoomIds)));
exports.getUniqueRoomIdsFromRoomStays = getUniqueRoomIdsFromRoomStays;
//# sourceMappingURL=roomStayHelpers.js.map