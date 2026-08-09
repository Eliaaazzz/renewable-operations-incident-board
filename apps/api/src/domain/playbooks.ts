import type { AlertType, NextAction } from '@incident-board/shared';

/**
 * Deterministic response playbooks, one per alert type.
 *
 * These back the rule-based insight provider. They are written from ordinary renewable-O&M
 * practice and are **not** shown to the language model: if the model saw them it would simply
 * echo them back, and the agreement between the two would stop being evidence of anything.
 * Keeping the deterministic answer independent is what makes it usable as a baseline to check
 * the model against.
 *
 * Declaring the map as `Record<AlertType, Playbook>` means adding an alert type without a
 * playbook is a compile error rather than a silent gap at runtime.
 */

export interface Playbook {
  readonly likelyCauses: readonly string[];
  readonly actions: readonly NextAction[];
}

export const PLAYBOOKS: Record<AlertType, Playbook> = {
  thermal_runaway_risk: {
    likelyCauses: [
      'Cell-level thermal event or venting inside the affected rack',
      'Failed cooling loop or obstructed airflow to the module',
      'Temperature sensor reporting a false excursion',
    ],
    actions: [
      {
        action: 'Treat as a safety incident: keep personnel clear of the enclosure and follow the site emergency plan',
        owner: 'field_tech',
        urgency: 'now',
      },
      {
        action: 'Command the affected rack offline and inhibit charge and discharge from the EMS',
        owner: 'remote_ops',
        urgency: 'now',
      },
      {
        action: 'Notify the battery OEM and open a warranty incident before anyone enters the container',
        owner: 'oem_vendor',
        urgency: 'now',
      },
    ],
  },

  battery_cell_temp_high: {
    likelyCauses: [
      'Cooling capacity insufficient for the ambient conditions or current duty cycle',
      'HVAC unit degraded, or filters and condenser blocked',
      'Cell imbalance concentrating heat in one module',
    ],
    actions: [
      {
        action: 'Reduce the rack power limit until cell temperatures return inside the operating band',
        owner: 'remote_ops',
        urgency: 'now',
      },
      {
        action: 'Check HVAC set-points, filters and coolant level for the affected container',
        owner: 'field_tech',
        urgency: 'today',
      },
      {
        action: 'Trend the cell temperature spread across the rack to identify an outlier module',
        owner: 'remote_ops',
        urgency: 'today',
      },
    ],
  },

  dc_arc_fault: {
    likelyCauses: [
      'Loose or corroded DC connector in the affected string',
      'Damaged conductor insulation between the array and the combiner',
      'Arc-fault detector false positive following an inverter restart',
    ],
    actions: [
      {
        action: 'Keep the string de-energised until it has been physically inspected',
        owner: 'field_tech',
        urgency: 'now',
      },
      {
        action: 'Inspect combiner box terminations and in-line connectors on the affected string',
        owner: 'field_tech',
        urgency: 'today',
      },
      {
        action: 'Review the inverter event log for repeat arc detections before re-energising',
        owner: 'remote_ops',
        urgency: 'today',
      },
    ],
  },

  ground_fault: {
    likelyCauses: [
      'Moisture ingress into a combiner box or cable junction',
      'Damaged cable insulation, often following trenching or rodent activity',
      'Failing insulation-monitoring device inside the inverter',
    ],
    actions: [
      {
        action: 'Leave the affected array isolated and treat all conductors as live until proven otherwise',
        owner: 'field_tech',
        urgency: 'now',
      },
      {
        action: 'Perform insulation-resistance testing string by string to locate the fault',
        owner: 'field_tech',
        urgency: 'today',
      },
      {
        action: 'Check combiner enclosures for water ingress following recent weather',
        owner: 'field_tech',
        urgency: 'today',
      },
    ],
  },

  hvac_failure: {
    likelyCauses: [
      'Compressor or fan failure in the container HVAC unit',
      'Blocked condenser coils or filters',
      'Loss of auxiliary supply to the HVAC circuit',
    ],
    actions: [
      {
        action: 'Derate or pause battery operation while enclosure cooling is unavailable',
        owner: 'remote_ops',
        urgency: 'now',
      },
      {
        action: 'Dispatch a technician to inspect the HVAC unit and restore cooling',
        owner: 'field_tech',
        urgency: 'today',
      },
      {
        action: 'Watch the enclosure temperature trend and escalate if it approaches the alarm band',
        owner: 'remote_ops',
        urgency: 'now',
      },
    ],
  },

  transformer_temp_high: {
    likelyCauses: [
      'Sustained loading above nameplate in high ambient temperature',
      'Cooling fans or radiators not running',
      'Low oil level or degraded oil circulation',
    ],
    actions: [
      {
        action: 'Reduce export to bring the transformer back inside its thermal rating',
        owner: 'remote_ops',
        urgency: 'now',
      },
      {
        action: 'Verify cooling fan operation and oil level at the transformer',
        owner: 'field_tech',
        urgency: 'today',
      },
      {
        action: 'Schedule oil sampling and dissolved-gas analysis if the excursion repeats',
        owner: 'asset_manager',
        urgency: 'this_week',
      },
    ],
  },

  tracker_stow_failure: {
    likelyCauses: [
      'Motor or gearbox failure on the affected tracker row',
      'Loss of communication to the tracker controller',
      'Position sensor misreporting and blocking the stow command',
    ],
    actions: [
      {
        action: 'Manually stow the affected rows ahead of the forecast wind event',
        owner: 'field_tech',
        urgency: 'now',
      },
      {
        action: 'Confirm stow status for every row on site, not only the row that alarmed',
        owner: 'remote_ops',
        urgency: 'now',
      },
      {
        action: 'Raise a repair job for the tracker drive once the weather has passed',
        owner: 'field_tech',
        urgency: 'this_week',
      },
    ],
  },

  bms_fault: {
    likelyCauses: [
      'Communication fault between the BMS and a module controller',
      'Firmware defect following a recent update',
      'Genuine cell measurement outside the permitted range',
    ],
    actions: [
      {
        action: 'Read the BMS fault code and confirm whether the rack has isolated itself',
        owner: 'remote_ops',
        urgency: 'now',
      },
      {
        action: 'Restart the BMS communication link if the code indicates a comms fault',
        owner: 'remote_ops',
        urgency: 'today',
      },
      {
        action: 'Escalate to the battery OEM with the fault log if the fault repeats',
        owner: 'oem_vendor',
        urgency: 'today',
      },
    ],
  },

  inverter_fault: {
    likelyCauses: [
      'Internal inverter fault requiring a manual reset',
      'Grid conditions outside the inverter ride-through envelope',
      'Cooling fan failure causing a thermal derate and then a trip',
    ],
    actions: [
      {
        action: 'Attempt a remote reset and confirm the inverter returns to grid',
        owner: 'remote_ops',
        urgency: 'now',
      },
      {
        action: 'Retrieve the fault code and check it against the OEM fault list',
        owner: 'remote_ops',
        urgency: 'today',
      },
      {
        action: 'Dispatch a technician if the fault recurs after two resets',
        owner: 'field_tech',
        urgency: 'today',
      },
    ],
  },

  inverter_offline: {
    likelyCauses: [
      'Inverter tripped and did not auto-restart',
      'Loss of auxiliary supply or communications to the inverter',
      'AC breaker open upstream of the inverter',
    ],
    actions: [
      {
        action: 'Confirm whether the inverter is genuinely offline or only unreachable by SCADA',
        owner: 'remote_ops',
        urgency: 'now',
      },
      {
        action: 'Check the upstream AC breaker position and the auxiliary supply',
        owner: 'field_tech',
        urgency: 'today',
      },
      {
        action: 'Quantify lost production and record it against the availability guarantee',
        owner: 'asset_manager',
        urgency: 'this_week',
      },
    ],
  },

  ac_breaker_trip: {
    likelyCauses: [
      'Protection operated on a genuine downstream fault',
      'Nuisance trip from a protection setting that is too tight',
      'Breaker mechanism or trip coil fault',
    ],
    actions: [
      {
        action: 'Do not reclose until the downstream circuit has been checked for a fault',
        owner: 'field_tech',
        urgency: 'now',
      },
      {
        action: 'Download the protection relay records to identify what operated',
        owner: 'remote_ops',
        urgency: 'today',
      },
      {
        action: 'Review protection settings with the asset owner if no primary fault is found',
        owner: 'asset_manager',
        urgency: 'this_week',
      },
    ],
  },

  grid_voltage_excursion: {
    likelyCauses: [
      'Network voltage moved outside the connection agreement band',
      'Plant reactive power control not responding correctly',
      'Voltage transducer or metering error',
    ],
    actions: [
      {
        action: 'Check reactive power set-points and confirm the plant controller is responding',
        owner: 'remote_ops',
        urgency: 'today',
      },
      {
        action: 'Log the excursion with the network operator against the connection agreement',
        owner: 'asset_manager',
        urgency: 'today',
      },
      {
        action: 'Verify the voltage measurement against a second instrument',
        owner: 'field_tech',
        urgency: 'this_week',
      },
    ],
  },

  string_underperformance: {
    likelyCauses: [
      'Module failure or bypass diode fault within the string',
      'Partial shading or localised soiling on the affected string',
      'Connector or fuse degradation raising series resistance',
    ],
    actions: [
      {
        action: 'Compare the string against its neighbours on the same combiner to confirm the shortfall',
        owner: 'remote_ops',
        urgency: 'today',
      },
      {
        action: 'Perform IV-curve tracing on the affected string',
        owner: 'field_tech',
        urgency: 'this_week',
      },
      {
        action: 'Check combiner fuses and connector torque during the next site visit',
        owner: 'field_tech',
        urgency: 'this_week',
      },
    ],
  },

  soiling_loss: {
    likelyCauses: [
      'Dust or pollen accumulation since the last cleaning cycle',
      'Bird or agricultural contamination on the affected area',
      'Soiling sensor drift overstating the loss',
    ],
    actions: [
      {
        action: 'Compare soiling-station readings against modelled clear-sky performance',
        owner: 'remote_ops',
        urgency: 'this_week',
      },
      {
        action: 'Schedule a cleaning cycle if the modelled revenue loss exceeds the cleaning cost',
        owner: 'asset_manager',
        urgency: 'this_week',
      },
      {
        action: 'Confirm the soiling reference sensor has itself been cleaned recently',
        owner: 'field_tech',
        urgency: 'this_week',
      },
    ],
  },

  soc_deviation: {
    likelyCauses: [
      'State-of-charge estimate drifting between the BMS and the EMS',
      'Dispatch not following the scheduled profile',
      'Calibration cycle overdue',
    ],
    actions: [
      {
        action: 'Compare BMS and EMS state-of-charge and identify which is drifting',
        owner: 'remote_ops',
        urgency: 'today',
      },
      {
        action: 'Check the market interface log for missed or rejected dispatch instructions',
        owner: 'remote_ops',
        urgency: 'today',
      },
      {
        action: 'Schedule a full charge and discharge calibration cycle',
        owner: 'asset_manager',
        urgency: 'this_week',
      },
    ],
  },

  aux_power_loss: {
    likelyCauses: [
      'Loss of the auxiliary supply transformer or its protection',
      'UPS reserve exhausted after an extended outage',
      'Auxiliary distribution board fault',
    ],
    actions: [
      {
        action: 'Confirm how long the UPS can hold protection, comms and cooling loads',
        owner: 'remote_ops',
        urgency: 'now',
      },
      {
        action: 'Restore the auxiliary supply before the UPS reserve is exhausted',
        owner: 'field_tech',
        urgency: 'now',
      },
      {
        action: 'Verify that protection and communications stayed powered throughout the outage',
        owner: 'field_tech',
        urgency: 'today',
      },
    ],
  },

  comms_loss: {
    likelyCauses: [
      'Site network, router or cellular link down',
      'Data logger fault or reboot loop',
      'Upstream SCADA or VPN outage rather than a site problem',
    ],
    actions: [
      {
        action: 'Check whether other sites on the same link are also affected before dispatching anyone',
        owner: 'remote_ops',
        urgency: 'now',
      },
      {
        action: 'Power-cycle the data logger and confirm it re-registers with SCADA',
        owner: 'field_tech',
        urgency: 'today',
      },
      {
        action: 'Backfill the missing telemetry once the link is restored',
        owner: 'remote_ops',
        urgency: 'today',
      },
    ],
  },

  irradiance_sensor_fault: {
    likelyCauses: [
      'Pyranometer soiled, shaded or knocked out of level',
      'Sensor cable or signal conditioner fault',
      'Sensor past its calibration interval',
    ],
    actions: [
      {
        action: 'Switch performance calculations to the secondary sensor until this is resolved',
        owner: 'remote_ops',
        urgency: 'today',
      },
      {
        action: 'Clean and re-level the pyranometer, then compare it against the secondary sensor',
        owner: 'field_tech',
        urgency: 'this_week',
      },
      {
        action: 'Book recalibration if the sensor is past its interval',
        owner: 'asset_manager',
        urgency: 'this_week',
      },
    ],
  },

  meter_data_gap: {
    likelyCauses: [
      'Meter communications interruption',
      'Meter clock drift causing intervals to be rejected',
      'Data collection platform outage',
    ],
    actions: [
      {
        action: 'Confirm the gap is a collection problem and not a genuine generation outage',
        owner: 'remote_ops',
        urgency: 'today',
      },
      {
        action: 'Retrieve the missing intervals directly from the meter register',
        owner: 'field_tech',
        urgency: 'today',
      },
      {
        action: 'Notify the settlement contact if the gap crosses a settlement boundary',
        owner: 'asset_manager',
        urgency: 'today',
      },
    ],
  },

  curtailment: {
    likelyCauses: [
      'Network operator constraint instruction',
      'Negative price or market-driven dispatch decision',
      'Local constraint management scheme active',
    ],
    actions: [
      {
        action: 'Confirm the instruction is recorded against the correct reason code',
        owner: 'remote_ops',
        urgency: 'this_week',
      },
      {
        action: 'Record the lost energy for compensation where the connection agreement allows it',
        owner: 'asset_manager',
        urgency: 'this_week',
      },
    ],
  },
};

export function playbookFor(type: AlertType): Playbook {
  return PLAYBOOKS[type];
}
