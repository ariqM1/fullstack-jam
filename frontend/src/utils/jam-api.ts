import axios from 'axios';

export interface ICompany {
    id: number;
    company_name: string;
    liked: boolean;
}

export interface ICollection {
    id: string;
    collection_name: string;
    companies: ICompany[];
    total: number;
}

export interface ICompanyBatchResponse {
    companies: ICompany[];
}

export interface IAddCompaniesRequest {
    company_ids: number[];
}

export interface IAddCompaniesResponse {
    operation_id: string;
    message: string;
}

export interface IOperationStatus {
    operation_id: string;
    status: 'pending' | 'in_progress' | 'completed' | 'failed';
    progress?: number;
    total?: number;
    error_message?: string;
}

const BASE_URL = 'http://localhost:8000';

export async function getCompanies(offset?: number, limit?: number): Promise<ICompanyBatchResponse> {
    try {
        const response = await axios.get(`${BASE_URL}/companies`, {
            params: {
                offset,
                limit,
            },
        });
        return response.data;
    } catch (error) {
        console.error('Error fetching companies:', error);
        throw error;
    }
}

export async function getCollectionsById(id: string, offset?: number, limit?: number): Promise<ICollection> {
    try {
        const response = await axios.get(`${BASE_URL}/collections/${id}`, {
            params: {
                offset,
                limit,
            },
        });
        return response.data;
    } catch (error) {
        console.error('Error fetching companies:', error);
        throw error;
    }
}

export async function getCollectionsMetadata(): Promise<ICollection[]> {
    try {
        const response = await axios.get(`${BASE_URL}/collections`);
        return response.data;
    } catch (error) {
        console.error('Error fetching companies:', error);
        throw error;
    }
}

export async function addCompaniesToCollection(
    sourceCollectionId: string,
    targetCollectionId: string,
    companyIds: number[]
): Promise<IAddCompaniesResponse> {
    try {
        const response = await axios.post(
            `${BASE_URL}/collections/${sourceCollectionId}/add-to/${targetCollectionId}`,
            { company_ids: companyIds }
        );
        return response.data;
    } catch (error) {
        console.error('Error adding companies to collection:', error);
        throw error;
    }
}

export async function addAllCompaniesToCollection(
    sourceCollectionId: string,
    targetCollectionId: string
): Promise<IAddCompaniesResponse> {
    try {
        const response = await axios.post(
            `${BASE_URL}/collections/${sourceCollectionId}/add-all-to/${targetCollectionId}`
        );
        return response.data;
    } catch (error) {
        console.error('Error adding all companies to collection:', error);
        throw error;
    }
}

export async function getOperationStatus(operationId: string): Promise<IOperationStatus> {
    try {
        const response = await axios.get(`${BASE_URL}/collections/operations/${operationId}`);
        return response.data;
    } catch (error) {
        console.error('Error fetching operation status:', error);
        throw error;
    }
}