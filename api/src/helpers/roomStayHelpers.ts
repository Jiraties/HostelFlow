export type RoomStayLike = {
  roomId?: string | null;
  roomIds?: string[] | null;
};

export const getRoomStayRoomIds = (roomStay: RoomStayLike) => {
  const roomIds = Array.isArray(roomStay.roomIds)
    ? roomStay.roomIds
    : roomStay.roomId
      ? [roomStay.roomId]
      : [];

  return Array.from(
    new Set(roomIds.map((roomId) => roomId.trim()).filter(Boolean)),
  );
};

export const getPrimaryRoomId = (roomStay: RoomStayLike) =>
  getRoomStayRoomIds(roomStay)[0] || "";

export const formatRoomStayRooms = (roomStay: RoomStayLike) =>
  getRoomStayRoomIds(roomStay).join(", ");

export const normalizeRoomStay = <T extends RoomStayLike>(roomStay: T) => ({
  ...roomStay,
  roomIds: getRoomStayRoomIds(roomStay),
});

export const getUniqueRoomIdsFromRoomStays = (roomStays: RoomStayLike[]) =>
  Array.from(new Set(roomStays.flatMap(getRoomStayRoomIds)));
