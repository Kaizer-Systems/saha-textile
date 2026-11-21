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

/** Screen key (from the approved menu) → its live tabs and forms. */
export const PRODUCT_SCREENS: Record<string, ProductScreen> = {
	droplets: dropletScreen,
	volumes: volumeScreen,
	dobackups: backupsScreen,
	cloudnet: networkScreen,
	doautoscale: autoscaleScreen,
	kubernetes: kubernetesScreen,
	apps: appsScreen,
	functions: functionsScreen,
	nfs: nfsScreen,
	databases: databasesScreen,
	registry: registryScreen,
	images: imagesScreen,
	loadbalancers: loadBalancersScreen,
	dodns: doDnsScreen,
	certificates: certificatesScreen,
	domonitoring: monitoringScreen,
	inference: inferenceScreen,
	donetadv: vpcPeeringScreen,
	spaces: spacesScreen,
	dosecrets: doSecretsScreen,
	security: securityScreen,
	doaccount: doAccountScreen,
};
