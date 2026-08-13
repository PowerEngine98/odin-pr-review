/**
 * The payload, as the components see it.
 *
 * Declared a directory up, outside `src/app`, because the extension has to be
 * able to build one and everything under `src/app` is compiled by the bundler
 * rather than by `tsc`. Re-exported here so the components import their model
 * from beside themselves, the way the canvas does.
 */
export type {
  ChangeView,
  FileView,
  FolderView,
  PickerView,
  PullView,
  Query,
  RefView,
  SidebarModel,
  TotalsView,
} from "../../sidebar-model.js";
