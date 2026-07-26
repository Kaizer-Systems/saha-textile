import OriginalComponentTypes from '@theme-original/NavbarItem/ComponentTypes';
import ChildToolNavbarItem from '@site/src/components/ChildToolNavbarItem';
import LiveContextNavbarItem from '@site/src/components/EngineeringLiveContext/LiveContextNavbarItem';
import type { ComponentTypesObject } from '@theme/NavbarItem/ComponentTypes';

const ComponentTypes: ComponentTypesObject = {
	...OriginalComponentTypes,
	'custom-childTool': ChildToolNavbarItem,
	'custom-liveContext': LiveContextNavbarItem,
};

export default ComponentTypes;
