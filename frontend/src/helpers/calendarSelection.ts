// Nights occupy [start, end): the final boundary is next month's first day.
export const calendarMonthBoundaries = (year: number, month: number) =>
  Array.from(
    { length: new Date(year, month + 1, 0).getDate() + 1 },
    (_, index) => new Date(year, month, index + 1),
  );

export const calendarBoundaryAtPointer = (
  columns: readonly { left: number; right: number }[],
  clientX: number,
) => {
  if (!columns.length) return null;
  if (clientX <= columns[0].left) return 0;
  for (let index = 0; index < columns.length; index += 1) {
    const column = columns[index];
    if (clientX <= column.right) {
      return index + (clientX >= (column.left + column.right) / 2 ? 1 : 0);
    }
  }
  return columns.length;
};

export const calendarDragHasMoved = (
  startX: number, startY: number, clientX: number, clientY: number,
) => Math.hypot(clientX - startX, clientY - startY) >= 4;

// A real drag confined to its starting day still represents that one night.
export const calendarDragEndpoint = (anchor: number, boundary: number) =>
  boundary === anchor ? anchor + 1 : boundary;

export const clampCalendarSelectionEnd = (
  anchor: number,
  requested: number,
  nightIsUnavailable: (index: number) => boolean,
) => {
  if (requested > anchor) {
    for (let index = anchor; index < requested; index += 1) {
      if (nightIsUnavailable(index)) return index;
    }
  } else {
    for (let index = anchor - 1; index >= requested; index -= 1) {
      if (nightIsUnavailable(index)) return index + 1;
    }
  }
  return requested;
};
