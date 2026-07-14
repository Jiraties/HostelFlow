"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.roomGuestCapacity = exports.invalidRoomIds = exports.activeRoomInventory = exports.ROOM_INVENTORY = void 0;
const numberedRooms = (prefix, count) => Array.from({ length: count }, (_, index) => ({
    id: `${prefix} ${index + 1}`,
    capacity: 1,
    active: true,
}));
/** Backend-owned room/bed inventory used by validation and calendar output. */
exports.ROOM_INVENTORY = [
    { id: "Balcony", capacity: 2, active: true },
    { id: "Window", capacity: 2, active: true },
    { id: "Pottery 1", capacity: 3, active: true },
    { id: "Pottery 2", capacity: 3, active: true },
    ...numberedRooms("Siesta", 14),
    ...numberedRooms("Marquisette", 8),
    ...numberedRooms("Homespan", 8),
    ...numberedRooms("Veranda", 6),
    ...numberedRooms("Wicker", 6),
];
const inventoryById = new Map(exports.ROOM_INVENTORY.map((room) => [room.id, room]));
const activeRoomInventory = () => exports.ROOM_INVENTORY.filter((room) => room.active);
exports.activeRoomInventory = activeRoomInventory;
const invalidRoomIds = (roomIds) => roomIds.filter((roomId) => !inventoryById.get(roomId)?.active);
exports.invalidRoomIds = invalidRoomIds;
const roomGuestCapacity = (roomId) => inventoryById.get(roomId)?.capacity || 1;
exports.roomGuestCapacity = roomGuestCapacity;
//# sourceMappingURL=roomInventory.js.map