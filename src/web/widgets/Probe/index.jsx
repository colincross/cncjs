import includes from 'lodash/includes';
import map from 'lodash/map';
import classNames from 'classnames';
import PropTypes from 'prop-types';
import React, { PureComponent } from 'react';
import Widget from '../../components/Widget';
import controller from '../../lib/controller';
import i18n from '../../lib/i18n';
import { in2mm, mm2in } from '../../lib/units';
import WidgetConfig from '../WidgetConfig';
import Probe from './Probe';
import ZProbe from './ZProbe';
import {
    // Units
    IMPERIAL_UNITS,
    METRIC_UNITS,
    // Controller
    GRBL,
    GRBL_MACHINE_STATE_IDLE,
    SMOOTHIE,
    SMOOTHIE_MACHINE_STATE_IDLE,
    TINYG,
    TINYG_MACHINE_STATE_READY,
    TINYG_MACHINE_STATE_STOP,
    TINYG_MACHINE_STATE_END,
    // Workflow
    WORKFLOW_STATE_RUNNING
} from '../../constants';
import {
    MODAL_NONE,
    MODAL_PREVIEW
} from './constants';
import styles from './index.styl';

const toUnits = (units, val) => {
    val = Number(val) || 0;
    if (units === IMPERIAL_UNITS) {
        val = mm2in(val).toFixed(4) * 1;
    }
    if (units === METRIC_UNITS) {
        val = val.toFixed(3) * 1;
    }

    return val;
};

const gcode = (cmd, params) => {
    const s = map(params, (value, letter) => String(letter + value)).join(' ');
    return (s.length > 0) ? (cmd + ' ' + s) : cmd;
};

class ProbeWidget extends PureComponent {
    static propTypes = {
        widgetId: PropTypes.string.isRequired,
        onFork: PropTypes.func.isRequired,
        onRemove: PropTypes.func.isRequired,
        sortable: PropTypes.object
    };

    // Public methods
    collapse = () => {
        this.setState({ minimized: true });
    };
    expand = () => {
        this.setState({ minimized: false });
    };

    config = new WidgetConfig(this.props.widgetId);
    state = this.getInitialState();
    actions = {
        toggleFullscreen: () => {
            const { minimized, isFullscreen } = this.state;
            this.setState({
                minimized: isFullscreen ? minimized : false,
                isFullscreen: !isFullscreen
            });
        },
        toggleMinimized: () => {
            const { minimized } = this.state;
            this.setState({ minimized: !minimized });
        },
        openModal: (name = MODAL_NONE, params = {}) => {
            this.setState({
                modal: {
                    name: name,
                    params: params
                }
            });
        },
        closeModal: () => {
            this.setState({
                modal: {
                    name: MODAL_NONE,
                    params: {}
                }
            });
        },
        updateModalParams: (params = {}) => {
            this.setState({
                modal: {
                    ...this.state.modal,
                    params: {
                        ...this.state.modal.params,
                        ...params
                    }
                }
            });
        },
        changeProbeCommand: (value) => {
            this.setState({ probeCommand: value });
        },
        toggleUseTLO: () => {
            const { useTLO } = this.state;
            this.setState({ useTLO: !useTLO });
        },
        handleProbeDepthChange: (event) => {
            const probeDepth = event.target.value;
            this.setState({ probeDepth });
        },
        handleProbeFeedrateChange: (event) => {
            const probeFeedrate = event.target.value;
            this.setState({ probeFeedrate });
        },
        handleTouchPlateHeightChange: (event) => {
            const touchPlateHeight = event.target.value;
            this.setState({ touchPlateHeight });
        },
        handleRetractionDistanceChange: (event) => {
            const retractionDistance = event.target.value;
            this.setState({ retractionDistance });
        },
        populateProbeCommands: () => {
            const {
                probeCommand,
                useTLO,
                probeDepth,
                probeFeedrate,
                touchPlateHeight,
                retractionDistance
            } = this.state;
            const { wcs } = controller.getModalState();
            const mapWCSToP = (wcs) => ({
                'G54': 1,
                'G55': 2,
                'G56': 3,
                'G57': 4,
                'G58': 5,
                'G59': 6
            }[wcs] || 0);
            const towardWorkpiece = includes(['G38.2', 'G38.3'], probeCommand);
            const tloProbeCommands = [
                gcode('; Cancel tool length offset'),
                // Cancel tool length offset
                gcode('G49'),

                // Z-Probe (use relative distance mode)
                gcode('; Z-Probe'),
                gcode('G91'),
                gcode(probeCommand, {
                    Z: towardWorkpiece ? -probeDepth : probeDepth,
                    F: probeFeedrate
                }),
                // Use absolute distance mode
                gcode('G90'),

                // Dwell
                gcode('; A dwell time of one second'),
                gcode('G4 P1'),

                // Apply touch plate height with tool length offset
                gcode('; Set tool length offset'),
                gcode('G43.1', {
                    Z: towardWorkpiece ? `[posz-${touchPlateHeight}]` : `[posz+${touchPlateHeight}]`
                }),

                // Retract from the touch plate (use relative distance mode)
                gcode('; Retract from the touch plate'),
                gcode('G91'),
                gcode('G0', {
                    Z: retractionDistance
                }),
                // Use asolute distance mode
                gcode('G90')
            ];
            const wcsProbeCommands = [
                // Z-Probe (use relative distance mode)
                gcode('; Z-Probe'),
                gcode('G91'),
                gcode(probeCommand, {
                    Z: towardWorkpiece ? -probeDepth : probeDepth,
                    F: probeFeedrate
                }),
                // Use absolute distance mode
                gcode('G90'),

                // Set the WCS Z0
                gcode('; Set the active WCS Z0'),
                gcode('G10', {
                    L: 20,
                    P: mapWCSToP(wcs),
                    Z: touchPlateHeight
                }),

                // Retract from the touch plate (use relative distance mode)
                gcode('; Retract from the touch plate'),
                gcode('G91'),
                gcode('G0', {
                    Z: retractionDistance
                }),
                // Use absolute distance mode
                gcode('G90')
            ];

            return useTLO ? tloProbeCommands : wcsProbeCommands;
        },
        runProbeCommands: (commands) => {
            controller.command('gcode', commands);
        }
    };
    controllerEvents = {
        'connection:open': (options) => {
            const { ident } = options;
            this.setState(state => ({
                connection: {
                    ...state.connection,
                    ident: ident
                }
            }));
        },
        'connection:close': (options) => {
            const initialState = this.getInitialState();
            this.setState({ ...initialState });
        },
        'workflow:state': (workflowState) => {
            this.setState(state => ({
                workflow: {
                    state: workflowState
                }
            }));
        },
        'controller:state': (type, state) => {
            // Grbl
            if (type === GRBL) {
                const { modal = {} } = { ...state };
                const units = {
                    'G20': IMPERIAL_UNITS,
                    'G21': METRIC_UNITS
                }[modal.units] || this.state.units;

                let {
                    probeDepth,
                    probeFeedrate,
                    touchPlateHeight,
                    retractionDistance
                } = this.config.get();
                if (units === IMPERIAL_UNITS) {
                    probeDepth = mm2in(probeDepth).toFixed(4) * 1;
                    probeFeedrate = mm2in(probeFeedrate).toFixed(4) * 1;
                    touchPlateHeight = mm2in(touchPlateHeight).toFixed(4) * 1;
                    retractionDistance = mm2in(retractionDistance).toFixed(4) * 1;
                }
                if (units === METRIC_UNITS) {
                    probeDepth = Number(probeDepth).toFixed(3) * 1;
                    probeFeedrate = Number(probeFeedrate).toFixed(3) * 1;
                    touchPlateHeight = Number(touchPlateHeight).toFixed(3) * 1;
                    retractionDistance = Number(retractionDistance).toFixed(3) * 1;
                }

                if (this.state.units !== units) {
                    // Set `this.unitsDidChange` to true if the unit has changed
                    this.unitsDidChange = true;
                }

                this.setState({
                    units: units,
                    controller: {
                        type: type,
                        state: state
                    },
                    probeDepth: probeDepth,
                    probeFeedrate: probeFeedrate,
                    touchPlateHeight: touchPlateHeight,
                    retractionDistance: retractionDistance
                });
            }

            // Smoothie
            if (type === SMOOTHIE) {
                const { modal = {} } = { ...state };
                const units = {
                    'G20': IMPERIAL_UNITS,
                    'G21': METRIC_UNITS
                }[modal.units] || this.state.units;

                let {
                    probeDepth,
                    probeFeedrate,
                    touchPlateHeight,
                    retractionDistance
                } = this.config.get();
                if (units === IMPERIAL_UNITS) {
                    probeDepth = mm2in(probeDepth).toFixed(4) * 1;
                    probeFeedrate = mm2in(probeFeedrate).toFixed(4) * 1;
                    touchPlateHeight = mm2in(touchPlateHeight).toFixed(4) * 1;
                    retractionDistance = mm2in(retractionDistance).toFixed(4) * 1;
                }
                if (units === METRIC_UNITS) {
                    probeDepth = Number(probeDepth).toFixed(3) * 1;
                    probeFeedrate = Number(probeFeedrate).toFixed(3) * 1;
                    touchPlateHeight = Number(touchPlateHeight).toFixed(3) * 1;
                    retractionDistance = Number(retractionDistance).toFixed(3) * 1;
                }

                if (this.state.units !== units) {
                    // Set `this.unitsDidChange` to true if the unit has changed
                    this.unitsDidChange = true;
                }

                this.setState({
                    units: units,
                    controller: {
                        type: type,
                        state: state
                    },
                    probeDepth: probeDepth,
                    probeFeedrate: probeFeedrate,
                    touchPlateHeight: touchPlateHeight,
                    retractionDistance: retractionDistance
                });
            }

            // TinyG
            if (type === TINYG) {
                const { modal = {} } = { ...state };
                const units = {
                    'G20': IMPERIAL_UNITS,
                    'G21': METRIC_UNITS
                }[modal.units] || this.state.units;

                let {
                    probeDepth,
                    probeFeedrate,
                    touchPlateHeight,
                    retractionDistance
                } = this.config.get();
                if (units === IMPERIAL_UNITS) {
                    probeDepth = mm2in(probeDepth).toFixed(4) * 1;
                    probeFeedrate = mm2in(probeFeedrate).toFixed(4) * 1;
                    touchPlateHeight = mm2in(touchPlateHeight).toFixed(4) * 1;
                    retractionDistance = mm2in(retractionDistance).toFixed(4) * 1;
                }
                if (units === METRIC_UNITS) {
                    probeDepth = Number(probeDepth).toFixed(3) * 1;
                    probeFeedrate = Number(probeFeedrate).toFixed(3) * 1;
                    touchPlateHeight = Number(touchPlateHeight).toFixed(3) * 1;
                    retractionDistance = Number(retractionDistance).toFixed(3) * 1;
                }

                if (this.state.units !== units) {
                    // Set `this.unitsDidChange` to true if the unit has changed
                    this.unitsDidChange = true;
                }

                this.setState({
                    units: units,
                    controller: {
                        type: type,
                        state: state
                    },
                    probeDepth: probeDepth,
                    probeFeedrate: probeFeedrate,
                    touchPlateHeight: touchPlateHeight,
                    retractionDistance: retractionDistance
                });
            }
        }
    };
    unitsDidChange = false;

    componentDidMount() {
        this.addControllerEvents();
    }
    componentWillUnmount() {
        this.removeControllerEvents();
    }
    componentDidUpdate(prevProps, prevState) {
        const {
            minimized
        } = this.state;

        this.config.set('minimized', minimized);

        // Do not save config settings if the units did change between in and mm
        if (this.unitsDidChange) {
            this.unitsDidChange = false;
            return;
        }

        const { units, probeCommand, useTLO } = this.state;
        this.config.set('probeCommand', probeCommand);
        this.config.set('useTLO', useTLO);

        let {
            probeDepth,
            probeFeedrate,
            touchPlateHeight,
            retractionDistance
        } = this.state;

        // To save in mm
        if (units === IMPERIAL_UNITS) {
            probeDepth = in2mm(probeDepth);
            probeFeedrate = in2mm(probeFeedrate);
            touchPlateHeight = in2mm(touchPlateHeight);
            retractionDistance = in2mm(retractionDistance);
        }
        this.config.set('probeDepth', Number(probeDepth));
        this.config.set('probeFeedrate', Number(probeFeedrate));
        this.config.set('touchPlateHeight', Number(touchPlateHeight));
        this.config.set('retractionDistance', Number(retractionDistance));
    }
    getInitialState() {
        return {
            minimized: this.config.get('minimized', false),
            isFullscreen: false,
            canClick: false,
            units: METRIC_UNITS,
            controller: {
                type: controller.type,
                state: controller.state
            },
            connection: {
                ident: controller.connection.ident
            },
            workflow: {
                state: controller.workflow.state
            },
            modal: {
                name: MODAL_NONE,
                params: {}
            },
            probeCommand: this.config.get('probeCommand', 'G38.2'),
            useTLO: this.config.get('useTLO'),
            probeDepth: toUnits(METRIC_UNITS, this.config.get('probeDepth')),
            probeFeedrate: toUnits(METRIC_UNITS, this.config.get('probeFeedrate')),
            touchPlateHeight: toUnits(
                METRIC_UNITS,
                // widgets.probe.tlo is deprecated and will be removed in a future release`
                this.config.get('touchPlateHeight', this.config.get('tlo'))
            ),
            retractionDistance: toUnits(METRIC_UNITS, this.config.get('retractionDistance'))
        };
    }
    addControllerEvents() {
        Object.keys(this.controllerEvents).forEach(eventName => {
            const callback = this.controllerEvents[eventName];
            controller.addListener(eventName, callback);
        });
    }
    removeControllerEvents() {
        Object.keys(this.controllerEvents).forEach(eventName => {
            const callback = this.controllerEvents[eventName];
            controller.removeListener(eventName, callback);
        });
    }
    canClick() {
        const machineState = controller.getMachineState();

        if (!controller.connection.ident) {
            return false;
        }

        if (controller.type === GRBL && !includes([
            GRBL_MACHINE_STATE_IDLE
        ], machineState)) {
            return false;
        }

        if (controller.type === SMOOTHIE && !includes([
            SMOOTHIE_MACHINE_STATE_IDLE
        ], machineState)) {
            return false;
        }

        if (controller.type === TINYG && !includes([
            TINYG_MACHINE_STATE_READY,
            TINYG_MACHINE_STATE_STOP,
            TINYG_MACHINE_STATE_END
        ], machineState)) {
            return false;
        }

        if (controller.workflow.state === WORKFLOW_STATE_RUNNING) {
            return false;
        }

        return true;
    }
    render() {
        const { widgetId } = this.props;
        const { minimized, isFullscreen } = this.state;
        const isForkedWidget = widgetId.match(/\w+:[\w\-]+/);
        const state = {
            ...this.state,
            canClick: this.canClick()
        };
        const actions = {
            ...this.actions
        };

        return (
            <Widget fullscreen={isFullscreen}>
                <Widget.Header>
                    <Widget.Title>
                        <Widget.Sortable className={this.props.sortable.handleClassName}>
                            <i className="fa fa-bars" />
                            <span className="space" />
                        </Widget.Sortable>
                        {isForkedWidget &&
                        <i className="fa fa-code-fork" style={{ marginRight: 5 }} />
                        }
                        {i18n._('Probe')}
                    </Widget.Title>
                    <Widget.Controls className={this.props.sortable.filterClassName}>
                        <Widget.Button
                            disabled={isFullscreen}
                            title={minimized ? i18n._('Expand') : i18n._('Collapse')}
                            onClick={actions.toggleMinimized}
                        >
                            <i
                                className={classNames(
                                    'fa',
                                    { 'fa-chevron-up': !minimized },
                                    { 'fa-chevron-down': minimized }
                                )}
                            />
                        </Widget.Button>
                        <Widget.DropdownButton
                            title={i18n._('More')}
                            toggle={<i className="fa fa-ellipsis-v" />}
                            onSelect={(eventKey) => {
                                if (eventKey === 'fullscreen') {
                                    actions.toggleFullscreen();
                                } else if (eventKey === 'fork') {
                                    this.props.onFork();
                                } else if (eventKey === 'remove') {
                                    this.props.onRemove();
                                }
                            }}
                        >
                            <Widget.DropdownMenuItem eventKey="fullscreen">
                                <i
                                    className={classNames(
                                        'fa',
                                        'fa-fw',
                                        { 'fa-expand': !isFullscreen },
                                        { 'fa-compress': isFullscreen }
                                    )}
                                />
                                <span className="space space-sm" />
                                {!isFullscreen ? i18n._('Enter Full Screen') : i18n._('Exit Full Screen')}
                            </Widget.DropdownMenuItem>
                            <Widget.DropdownMenuItem eventKey="fork">
                                <i className="fa fa-fw fa-code-fork" />
                                <span className="space space-sm" />
                                {i18n._('Fork Widget')}
                            </Widget.DropdownMenuItem>
                            <Widget.DropdownMenuItem eventKey="remove">
                                <i className="fa fa-fw fa-times" />
                                <span className="space space-sm" />
                                {i18n._('Remove Widget')}
                            </Widget.DropdownMenuItem>
                        </Widget.DropdownButton>
                    </Widget.Controls>
                </Widget.Header>
                <Widget.Content
                    className={classNames(
                        styles['widget-content'],
                        { [styles.hidden]: minimized }
                    )}
                >
                    {state.modal.name === MODAL_PREVIEW &&
                    <ZProbe state={state} actions={actions} />
                    }
                    <Probe
                        state={state}
                        actions={actions}
                    />
                </Widget.Content>
            </Widget>
        );
    }
}

export default ProbeWidget;
