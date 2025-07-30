import {
	Alert,
	Box,
	Button,
	FormControl,
	InputLabel,
	LinearProgress,
	MenuItem,
	Select,
	Typography,
} from "@mui/material";
import { DataGrid, GridSelectionModel } from "@mui/x-data-grid";
import { useEffect, useState } from "react";
import {
	addAllCompaniesToCollection,
	addCompaniesToCollection,
	getCollectionsById,
	getOperationStatus,
	ICollection,
	ICompany,
	IOperationStatus,
} from "../utils/jam-api";

const CompanyTable = (props: {
	selectedCollectionId: string;
	collections: ICollection[];
}) => {
	const [response, setResponse] = useState<ICompany[]>([]);
	const [total, setTotal] = useState<number>();
	const [offset, setOffset] = useState<number>(0);
	const [pageSize, setPageSize] = useState(25);
	const [selectedCompanies, setSelectedCompanies] =
		useState<GridSelectionModel>([]);
	const [targetCollectionId, setTargetCollectionId] = useState<string>("");
	const [operations, setOperations] = useState<Map<string, IOperationStatus>>(
		new Map()
	);
	const [loading, setLoading] = useState(false);

	useEffect(() => {
		getCollectionsById(props.selectedCollectionId, offset, pageSize).then(
			(newResponse) => {
				setResponse(newResponse.companies);
				setTotal(newResponse.total);
			}
		);
	}, [props.selectedCollectionId, offset, pageSize]);

	useEffect(() => {
		setOffset(0);
		setSelectedCompanies([]);
	}, [props.selectedCollectionId]);

	const availableTargetCollections = props.collections.filter(
		(collection) => collection.id !== props.selectedCollectionId
	);

	const pollOperationStatus = async (operationId: string) => {
		const poll = async () => {
			try {
				const status = await getOperationStatus(operationId);
				setOperations((prev) => new Map(prev.set(operationId, status)));

				if (status.status === "in_progress") {
					setTimeout(poll, 1000); // Poll every second
				} else if (status.status === "completed") {
					// Reset to page 1 and refresh the table data
					setOffset(0);
					const newResponse = await getCollectionsById(
						props.selectedCollectionId,
						0,
						pageSize
					);
					setResponse(newResponse.companies);
					setTotal(newResponse.total);
					setLoading(false);
				} else if (status.status === "failed") {
					setLoading(false);
				}
			} catch (error) {
				console.error("Error polling operation status:", error);
				setLoading(false);
			}
		};
		poll();
	};

	const handleAddSelected = async () => {
		if (!targetCollectionId || selectedCompanies.length === 0) return;

		setLoading(true);
		try {
			const response = await addCompaniesToCollection(
				props.selectedCollectionId,
				targetCollectionId,
				selectedCompanies as number[]
			);
			pollOperationStatus(response.operation_id);
		} catch (error) {
			console.error("Error adding selected companies:", error);
			setLoading(false);
		}
	};

	const handleAddAll = async () => {
		if (!targetCollectionId) return;

		setLoading(true);
		try {
			const response = await addAllCompaniesToCollection(
				props.selectedCollectionId,
				targetCollectionId
			);
			pollOperationStatus(response.operation_id);
		} catch (error) {
			console.error("Error adding all companies:", error);
			setLoading(false);
		}
	};

	const getActiveOperation = (): IOperationStatus | null => {
		for (const [, operation] of operations) {
			if (operation.status === "in_progress") {
				return operation;
			}
		}
		return null;
	};

	const activeOperation = getActiveOperation();

	return (
		<div style={{ width: "100%" }}>
			{/* Action Panel */}
			<Box
				sx={{ mb: 2, p: 2, border: "1px solid #333", borderRadius: 1 }}
			>
				<Box
					sx={{
						display: "flex",
						gap: 2,
						alignItems: "center",
						mb: 2,
					}}
				>
					<FormControl
						variant="outlined"
						size="small"
						sx={{ minWidth: 200 }}
					>
						<InputLabel>Add to Collection</InputLabel>
						<Select
							value={targetCollectionId}
							onChange={(e) =>
								setTargetCollectionId(e.target.value)
							}
							label="Add to Collection"
							disabled={loading}
						>
							{availableTargetCollections.map((collection) => (
								<MenuItem
									key={collection.id}
									value={collection.id}
								>
									{collection.collection_name}
								</MenuItem>
							))}
						</Select>
					</FormControl>

					<Button
						variant="contained"
						onClick={handleAddSelected}
						disabled={
							!targetCollectionId ||
							selectedCompanies.length === 0 ||
							loading
						}
						size="small"
					>
						Add Selected ({selectedCompanies.length})
					</Button>

					<Button
						variant="outlined"
						onClick={handleAddAll}
						disabled={!targetCollectionId || loading}
						size="small"
					>
						Add All ({total || 0})
					</Button>
				</Box>

				{/* Progress Indicator */}
				{(activeOperation || loading) && (
					<Box
						sx={{
							mb: 2,
							p: 2,
							bgcolor: "background.paper",
							border: 1,
							borderColor: "divider",
							borderRadius: 1,
						}}
					>
						<Typography
							variant="body2"
							sx={{ mb: 1, fontWeight: "bold" }}
						>
							{activeOperation?.status === "in_progress"
								? `Processing... ${
										activeOperation.progress || 0
								  }/${activeOperation.total || 0} companies`
								: activeOperation?.status
								? `Status: ${activeOperation.status}`
								: "Operation starting..."}
						</Typography>
						{(activeOperation?.status === "in_progress" ||
							loading) && (
							<LinearProgress
								variant={
									activeOperation?.total
										? "determinate"
										: "indeterminate"
								}
								value={
									activeOperation?.total
										? ((activeOperation.progress || 0) /
												activeOperation.total) *
										  100
										: 0
								}
								sx={{ height: 8, borderRadius: 4 }}
							/>
						)}
					</Box>
				)}

				{/* Error Display */}
				{Array.from(operations.values()).some(
					(op) => op.status === "failed"
				) && (
					<Alert severity="error" sx={{ mb: 2 }}>
						Operation failed:{" "}
						{
							Array.from(operations.values()).find(
								(op) => op.status === "failed"
							)?.error_message
						}
					</Alert>
				)}
			</Box>

			{/* Data Grid */}
			<div style={{ height: 600, width: "100%" }}>
				<DataGrid
					rows={response}
					rowHeight={30}
					columns={[
						{ field: "liked", headerName: "Liked", width: 90 },
						{ field: "id", headerName: "ID", width: 90 },
						{
							field: "company_name",
							headerName: "Company Name",
							width: 300,
						},
					]}
					initialState={{
						pagination: {
							paginationModel: { page: 0, pageSize: 25 },
						},
					}}
					rowCount={total}
					pagination
					checkboxSelection
					paginationMode="server"
					onPaginationModelChange={(newMeta) => {
						setPageSize(newMeta.pageSize);
						setOffset(newMeta.page * newMeta.pageSize);
					}}
					onRowSelectionModelChange={(newSelection) => {
						setSelectedCompanies(newSelection);
					}}
					rowSelectionModel={selectedCompanies}
					loading={loading}
				/>
			</div>
		</div>
	);
};

export default CompanyTable;
