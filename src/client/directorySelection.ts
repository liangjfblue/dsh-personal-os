export interface PersonalDataDirectorySelection {
  pickDirectory: () => Promise<string | null>;
  setPersonalDataDirectory: (path: string) => Promise<void>;
}

export async function choosePersonalDataDirectory(
  selection: PersonalDataDirectorySelection,
): Promise<boolean> {
  const path = await selection.pickDirectory();
  if (path === null) return false;
  await selection.setPersonalDataDirectory(path);
  return true;
}
