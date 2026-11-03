export type RoomInventoryItem = {
  id: string;
  capacity: number;
  active: boolean;
  category: "private" | "dorm";
};

const numberedRooms = (prefix: string, count: number): RoomInventoryItem[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `${prefix} ${index + 1}`,
    capacity: 1,
    active: true,
    category: "dorm",
  }));

/** Backend-owned room/bed inventory used by validation and calendar output. */
export const ROOM_INVENTORY: readonly RoomInventoryItem[] = [
  { id: "Balcony", capacity: 2, active: true, category: "private" },
  { id: "Window", capacity: 2, active: true, category: "private" },
  { id: "Pottery 1", capacity: 3, active: true, category: "private" },
  { id: "Pottery 2", capacity: 3, active: true, category: "private" },
  ...numberedRooms("Siesta", 14),
  ...numberedRooms("Marquisette", 8),
  ...numberedRooms("Homespan", 8),
  ...numberedRooms("Veranda", 6),
  ...numberedRooms("Wicker", 6),
];

const inventoryById = new Map(ROOM_INVENTORY.map((room) => [room.id, room]));

export const activeRoomInventory = () =>
  ROOM_INVENTORY.filter((room) => room.active);

export const invalidRoomIds = (roomIds: string[]) =>
  roomIds.filter((roomId) => !inventoryById.get(roomId)?.active);

export const roomGuestCapacity = (roomId: string) =>
  inventoryById.get(roomId)?.capacity || 1;
