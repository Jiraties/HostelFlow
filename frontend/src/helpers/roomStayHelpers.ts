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

const roomPrefixAbbreviations: Record<string, string> = {
  Siesta: "S",
  Marquisette: "M",
  Homespan: "H",
  Veranda: "V",
  Wicker: "W",
};

const formatRoomPrefix = (prefix: string) =>
  roomPrefixAbbreviations[prefix] || prefix;

export const formatShortRoomName = (roomId: string) => {
  const normalizedRoomId = roomId.trim().replace(/\s+/g, " ");
  const match = normalizedRoomId.match(/^(.+?)\s+(\d+)$/);

  if (!match) return normalizedRoomId;

  return `${formatRoomPrefix(match[1])} ${match[2]}`;
};

type ParsedNumberedRoom = {
  original: string;
  prefix: string;
  number: number;
};

const parseNumberedRoom = (roomId: string): ParsedNumberedRoom | null => {
  const match = roomId.match(/^(.+?)\s+(\d+)$/);
  if (!match) return null;

  return {
    original: roomId,
    prefix: match[1],
    number: Number(match[2]),
  };
};

const formatNumberRanges = (numbers: number[]) => {
  const ranges = [...numbers]
    .sort((a, b) => a - b)
    .reduce<{ start: number; end: number }[]>((acc, number) => {
      const lastRange = acc[acc.length - 1];

      if (lastRange && number === lastRange.end + 1) {
        lastRange.end = number;
        return acc;
      }

      acc.push({ start: number, end: number });
      return acc;
    }, []);

  return ranges
    .map((range) =>
      range.start === range.end ? `${range.start}` : `${range.start}-${range.end}`,
    )
    .join(", ");
};

export const formatCompactRoomNames = (roomIds: string[]) => {
  const parsedGroups = new Map<string, ParsedNumberedRoom[]>();
  const unparsedRoomIds: string[] = [];

  roomIds.forEach((roomId) => {
    const parsedRoom = parseNumberedRoom(roomId);

    if (!parsedRoom) {
      unparsedRoomIds.push(roomId);
      return;
    }

    parsedGroups.set(parsedRoom.prefix, [
      ...(parsedGroups.get(parsedRoom.prefix) || []),
      parsedRoom,
    ]);
  });

  const compactNumberedRooms = Array.from(parsedGroups.entries()).map(
    ([prefix, rooms]) =>
      `${formatRoomPrefix(prefix)} ${formatNumberRanges(
        rooms.map((room) => room.number),
      )}`,
  );

  return [
    ...unparsedRoomIds.map(formatShortRoomName),
    ...compactNumberedRooms,
  ].join(", ");
};

export const formatRoomStayRooms = (roomStay: RoomStayLike) =>
  formatCompactRoomNames(getRoomStayRoomIds(roomStay));
