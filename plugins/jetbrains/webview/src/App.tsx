import { Board } from './components/Board.js';
import { useBoard } from './hooks/useBoard.js';
import './styles.css';

export function App() {
  const { board, runningCards, moveCard, openFile, createCard, deleteCard, changeEpic, resumeSession, setWorkflow, reorderColumns, updateSettings, createJiraIssue, createEpic, createWorkflow, updateWorkflow, deleteWorkflow, filterEpic, updateDoneFilter } = useBoard();

  if (!board) {
    return <div className="loading">Loading...</div>;
  }

  return (
    <Board
      board={board}
      runningCards={runningCards}
      onMoveCard={moveCard}
      onOpenFile={openFile}
      onCreateCard={createCard}
      onResume={resumeSession}
      onSetWorkflow={setWorkflow}
      onReorderColumns={reorderColumns}
      onUpdateSettings={updateSettings}
      onDeleteCard={deleteCard}
      onCreateJira={createJiraIssue}
      onCreateWorkflow={createWorkflow}
      onUpdateWorkflow={updateWorkflow}
      onDeleteWorkflow={deleteWorkflow}
      onCreateEpic={createEpic}
      onChangeEpic={changeEpic}
      onFilterEpic={filterEpic}
      onUpdateDoneFilter={updateDoneFilter}
    />
  );
}
