import { config } from "../package.json";
import hooks from "./hooks";
import { createZToolkit } from "./utils/ztoolkit";
import { AnnotationExportService } from "./services/annotationExport";
import { openOverviewWindow } from "./modules/overview-window";

class Addon {
  public data: {
    alive: boolean;
    config: typeof config;
    // Env type, see build.js
    env: "development" | "production";
    initialized?: boolean;
    ztoolkit: ZToolkit;
    locale?: {
      current: any;
    };
    menusRegistered?: boolean;
    prefs?: {
      window: Window;
    };
    annotationExport: AnnotationExportService;
  };
  // Lifecycle hooks
  public hooks: typeof hooks;
  // APIs
  public api: { openOverview: () => Window };

  constructor() {
    this.data = {
      alive: true,
      config,
      env: __env__,
      initialized: false,
      ztoolkit: createZToolkit(),
      menusRegistered: false,
      annotationExport: new AnnotationExportService(),
    };
    this.hooks = hooks;
    this.api = { openOverview: () => openOverviewWindow() };
  }
}

export default Addon;
