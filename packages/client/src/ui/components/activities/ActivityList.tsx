import { Component, For } from 'solid-js';
import { ActivityCard } from './ActivityCard';
import type { Activity } from '@partage/shared';

export interface ActivityListProps {
  activities: Activity[];
}

export const ActivityList: Component<ActivityListProps> = (props) => {
  return (
    <div class="activity-list">
      <For each={props.activities}>{(activity) => <ActivityCard activity={activity} />}</For>
    </div>
  );
};
