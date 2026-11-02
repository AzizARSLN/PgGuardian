import trCommon from "./tr/common.json";
import enCommon from "./en/common.json";
import trMonitor from "./tr/monitor.json";
import enMonitor from "./en/monitor.json";
import trExplore from "./tr/explore.json";
import enExplore from "./en/explore.json";
import trOperate from "./tr/operate.json";
import enOperate from "./en/operate.json";
import trAdmin from "./tr/admin.json";
import enAdmin from "./en/admin.json";
import trPgbadger from "./tr/pgbadger.json";
import enPgbadger from "./en/pgbadger.json";
import trStatements from "./tr/statements.json";
import enStatements from "./en/statements.json";

export type Locale = "tr" | "en";

export const messages: Record<Locale, Record<string, unknown>> = {
  tr: { ...trCommon, ...trMonitor, ...trExplore, ...trOperate, ...trAdmin, ...trStatements, ...trPgbadger },
  en: { ...enCommon, ...enMonitor, ...enExplore, ...enOperate, ...enAdmin, ...enStatements, ...enPgbadger },
};
