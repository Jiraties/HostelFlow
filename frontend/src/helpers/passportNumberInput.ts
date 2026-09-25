export const uppercasePassportNumberLetters = (value: string) =>
  value.replace(/[a-z]/g, (letter) => letter.toUpperCase());
