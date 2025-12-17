/**
 * @format
 */
import React from 'react';
import {AppRegistry} from 'react-native';
import navigation from './navigation';
/*import App from './App';*/
import {name as appName} from './app.json';

/*AppRegistry.registerComponent(appName, () => App);*/
AppRegistry.registerComponent(appName, () => navigation); // Register the Navigation