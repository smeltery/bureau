export interface SkillRoot {
  id: string;
  label: string;
  writable: boolean;
}
export interface LibrarySkill {
  id: string;
  rootId: string;
  name: string;
  description?: string;
  aliases: string[];
  writable: boolean;
}
export interface SkillLibrary {
  roots: SkillRoot[];
  skills: LibrarySkill[];
  commands: { name: string; description?: string; aliases: string[] }[];
}
export interface SkillDocument {
  content: string;
  version: string;
}
