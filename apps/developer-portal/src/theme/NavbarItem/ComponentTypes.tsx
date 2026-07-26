import OriginalComponentTypes from '@theme-original/NavbarItem/ComponentTypes';
import LiveContextNavbarItem from '@site/src/components/EngineeringLiveContext/LiveContextNavbarItem';
import type { ComponentTypesObject } from '@theme/NavbarItem/ComponentTypes';

const ComponentTypes: ComponentTypesObject = {
	...OriginalComponentTypes,
	'custom-liveContext': LiveContextNavbarItem,
};

export default ComponentTypes;
