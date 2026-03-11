#!/usr/bin/env node

import { Command } from 'commander';
import { registerJiraCommands } from './jira.js';

const program = new Command();

program
  .name('argustack')
  .description('Project analysis platform — Jira + Git + DB')
  .version('0.1.0');

registerJiraCommands(program);

program.parse();
