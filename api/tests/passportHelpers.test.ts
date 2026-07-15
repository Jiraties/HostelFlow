import assert from "node:assert/strict";
import test from "node:test";

import {
  formatDestinationCountryForReport,
  formatNationalityToReportNumber,
  formatRoomIdToReportNumber,
  reportDestinationCountries,
} from "../src/helpers/passportHelpers";

test("hotel destination countries use the authoritative report country codes", () => {
  for (const country of reportDestinationCountries) {
    const destination = formatDestinationCountryForReport(country.value);

    assert.equal(destination?.label, country.label);
    assert.equal(
      destination?.code,
      formatNationalityToReportNumber(country.value),
    );
  }

  assert.equal(formatDestinationCountryForReport("THA")?.code, 99);
});

test("hotel accommodation room codes map to their official report numbers", () => {
  const roomCodes: Array<[string, number]> = [
    ["H", 1],
    ["S", 2],
    ["Pottery 2", 3],
    ["Window", 4],
    ["Pottery 1", 5],
    ["Balcony", 6],
    ["V", 7],
    ["W", 8],
    ["M", 9],
  ];

  for (const [roomCode, reportNumber] of roomCodes) {
    assert.equal(formatRoomIdToReportNumber(roomCode), reportNumber);
  }
});

test("numbered room IDs use the same report number as their room prefix", () => {
  const numberedRoomIds: Array<[string, number]> = [
    ["Homespan 8", 1],
    ["Siesta 14", 2],
    ["Veranda 6", 7],
    ["Wicker 6", 8],
    ["Marquisette 8", 9],
  ];

  for (const [roomId, reportNumber] of numberedRoomIds) {
    assert.equal(formatRoomIdToReportNumber(roomId), reportNumber);
  }
});
