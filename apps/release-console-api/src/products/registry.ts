import type { ProductScreen } from './kit.js';
import { backupsScreen, dropletScreen, volumeScreen } from './do-compute.js';
import { networkScreen } from './do-network.js';
import {
	appsScreen,
	autoscaleScreen,
	databasesScreen,
	functionsScreen,
	imagesScreen,
	kubernetesScreen,
	nfsScreen,
	registryScreen,
} from './do-platform.js';
import {
	certificatesScreen,
	doAccountScreen,
	doDnsScreen,
	doSecretsScreen,
	inferenceScreen,
	loadBalancersScreen,
	monitoringScreen,
	securityScreen,
	spacesScreen,
	vpcPeeringScreen,
} from './do-services.js';

import {
	cfAccountScreen,
	cfAgentScreen,
	cfAiCrawlScreen,
	cfBuildScreen,
	cfDevScreen,
	cfDomainsScreen,
	cfHomeScreen,
	cfProtectScreen,
	cfZeroTrustScreen,
} from './cf-account.js';
import {
	ACCESS_EXTRA,
	CACHE_EXTRA,
	DNS_EXTRA,
	EMAIL_EXTRA,
	ERROR_EXTRA,
	OBS_EXTRA,
	ROUTES_EXTRA,
	SPEED_EXTRA,
	SSL_EXTRA,
	TRAFFIC_EXTRA,
	WAF_EXTRA,
	extend,
} from './cf-zone-more.js';
import { ZT_EXTRA } from './cf-zt-more.js';
import { ENV_LABELS, envTagExtra, withEnvLabels } from './env-tags.js';
import { SPACES_MORE_EXTRA } from './do-spaces-more.js';
import { DB_COST_EXTRA, DROPLET_COST_EXTRA, K8S_COST_EXTRA, SPACES_CDN_EXTRA } from './do-cost.js';
import { ACCOUNT_EXTRA, DATABASES_EXTRA, DODNS_EXTRA, MONITORING_EXTRA, NET_EXTRA, REGISTRY_EXTRA } from './do-more.js';
import { cfPlanScreen } from './cf-plan.js';
import { PIPELINE_EXTRA, PULLS_EXTRA, ROLLBACK_EXTRA, SECRETS_EXTRA, depsAlertsScreen } from './gh-more.js';
import {
	ALERTS_EXTRA,
	ANALYTICS_EXTRA,
	BUILD_EXTRA,
	DEV_EXTRA,
	RULES_LISTS_EXTRA,
	TURNSTILE_EXTRA,
} from './cf-build-more.js';
import {
	cfAccessScreen,
	cfAnalyticsScreen,
	cfBotsScreen,
	cfCacheScreen,
	cfDnsScreen,
	cfEmailScreen,
	cfErrorScreen,
	cfNetworkScreen,
	cfObservabilityScreen,
	cfOverviewScreen,
	cfRoutesScreen,
	cfRulesScreen,
	cfSpeedScreen,
	cfSslScreen,
	cfTrafficScreen,
	cfWafScreen,
	cfWeb3Screen,
} from './cf-zone.js';

import {
	approvalsScreen,
	calendarScreen,
	impactScreen,
	loadTestScreen,
	logsScreen,
	pipelineScreen,
	pullsScreen,
	rehearsalScreen,
	rollbackScreen,
	stepsScreen,
} from './ship.js';

import {
	cronScreen,
	databaseScreen,
	driftScreen,
	flagsScreen,
	mediaScreen,
	networkScreen as runNetworkScreen,
	processesScreen,
	searchScreen,
	serverScreen,
	tailMoreScreen,
	terminalScreen,
} from './run.js';
import {
	accessScreen,
	auditScreen,
	cdnScreen,
	dashboardsScreen,
	healthMoreScreen,
	incidentScreen,
	issuesScreen,
	paymentsScreen,
	privacyScreen,
	queriesScreen,
	rumScreen,
	sloScreen,
	tracesScreen,
	uptimeScreen,
} from './watch.js';

import { addExtras } from './extras.js';

/** Screen key (from the approved menu) → its live tabs and forms. */
export const PRODUCT_SCREENS: Record<string, ProductScreen> = {
	droplets: extend(extend(dropletScreen, DROPLET_COST_EXTRA), envTagExtra('droplet', 'detail')),
	volumes: volumeScreen,
	dobackups: backupsScreen,
	cloudnet: extend(networkScreen, NET_EXTRA),
	doautoscale: autoscaleScreen,
	kubernetes: extend(extend(kubernetesScreen, K8S_COST_EXTRA), envTagExtra('k8s')),
	apps: extend(appsScreen, envTagExtra('app')),
	functions: functionsScreen,
	nfs: nfsScreen,
	databases: extend(extend(extend(databasesScreen, DATABASES_EXTRA), DB_COST_EXTRA), envTagExtra('database')),
	registry: extend(registryScreen, REGISTRY_EXTRA),
	images: imagesScreen,
	loadbalancers: loadBalancersScreen,
	dodns: extend(doDnsScreen, DODNS_EXTRA),
	certificates: certificatesScreen,
	domonitoring: extend(monitoringScreen, MONITORING_EXTRA),
	inference: inferenceScreen,
	donetadv: vpcPeeringScreen,
	spaces: extend(extend(extend(spacesScreen, SPACES_CDN_EXTRA), SPACES_MORE_EXTRA), envTagExtra('spaces', 'buckets')),
	dosecrets: doSecretsScreen,
	security: securityScreen,
	doaccount: extend(doAccountScreen, ACCOUNT_EXTRA),
	cfhome: cfHomeScreen,
	cfdomains: cfDomainsScreen,
	cfbuild: extend(cfBuildScreen, BUILD_EXTRA),
	cfprotect: cfProtectScreen,
	cfzt: extend(cfZeroTrustScreen, ZT_EXTRA),
	cfdev: extend(cfDevScreen, DEV_EXTRA),
	cfaccount: extend(cfAccountScreen, ALERTS_EXTRA),
	cfoverview: cfOverviewScreen,
	cfaicrawl: cfAiCrawlScreen,
	cfagent: cfAgentScreen,
	cfanalytics: extend(cfAnalyticsScreen, ANALYTICS_EXTRA),
	cfobs: extend(cfObservabilityScreen, OBS_EXTRA),
	dns: extend(cfDnsScreen, DNS_EXTRA),
	cfemail: extend(cfEmailScreen, EMAIL_EXTRA),
	cfssl: extend(cfSslScreen, SSL_EXTRA),
	cfwaf: extend(cfWafScreen, WAF_EXTRA),
	cfbots: extend(cfBotsScreen, TURNSTILE_EXTRA),
	cfaccess: extend(cfAccessScreen, ACCESS_EXTRA),
	cfspeed: extend(cfSpeedScreen, SPEED_EXTRA),
	cfcache: extend(cfCacheScreen, CACHE_EXTRA),
	cfroutes: extend(cfRoutesScreen, ROUTES_EXTRA),
	cfrules: extend(cfRulesScreen, RULES_LISTS_EXTRA),
	cferror: extend(cfErrorScreen, ERROR_EXTRA),
	cfnetwork: cfNetworkScreen,
	cftraffic: extend(cfTrafficScreen, TRAFFIC_EXTRA),
	cfweb3: cfWeb3Screen,
	pulls: extend(pullsScreen, PULLS_EXTRA),
	pipeline: extend(pipelineScreen, PIPELINE_EXTRA),
	logs: logsScreen,
	approvals: approvalsScreen,
	steps: stepsScreen,
	impact: impactScreen,
	rollback: extend(rollbackScreen, ROLLBACK_EXTRA),
	calendar: calendarScreen,
	rehearsal: rehearsalScreen,
	loadtest: loadTestScreen,
	processes: processesScreen,
	server: serverScreen,
	terminal: terminalScreen,
	tail: tailMoreScreen,
	network: runNetworkScreen,
	cdn: cdnScreen,
	database: databaseScreen,
	search: searchScreen,
	media: mediaScreen,
	cron: cronScreen,
	flags: flagsScreen,
	drift: driftScreen,
	issues: issuesScreen,
	incident: incidentScreen,
	traces: tracesScreen,
	queries: queriesScreen,
	rum: rumScreen,
	health: healthMoreScreen,
	uptime: uptimeScreen,
	slo: sloScreen,
	dashboards: dashboardsScreen,
	payments: paymentsScreen,
	access: accessScreen,
	audit: auditScreen,
	privacy: privacyScreen,
};

addExtras(PRODUCT_SCREENS);
// Not a menu screen: the plan locks' live answer (cf-plan.ts).
PRODUCT_SCREENS['cfplan'] = cfPlanScreen;
// Dependencies keeps its own page; its Dismiss tab is drawn by the products engine.
PRODUCT_SCREENS['deps'] = depsAlertsScreen;
// Both lists name only screens registered above, so each is there.
PRODUCT_SCREENS['secrets'] = extend(PRODUCT_SCREENS['secrets'] as ProductScreen, SECRETS_EXTRA);
// Environment labels on pages without the environment switch (owner, 23 Nov).
for (const [name, spec] of Object.entries(ENV_LABELS))
	PRODUCT_SCREENS[name] = withEnvLabels(PRODUCT_SCREENS[name] as ProductScreen, spec);
