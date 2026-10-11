import { taskStore } from "../../tasks/store.ts";

export const loadTasks = () => taskStore.load();
