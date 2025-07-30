import uuid
import asyncio
from typing import Optional

from fastapi import APIRouter, Depends, Query, HTTPException, BackgroundTasks
from pydantic import BaseModel
from sqlalchemy import func, and_
from sqlalchemy.orm import Session

from backend.db import database
from backend.routes.companies import (
    CompanyBatchOutput,
    fetch_companies_with_liked,
)

router = APIRouter(
    prefix="/collections",
    tags=["collections"],
)


class CompanyCollectionMetadata(BaseModel):
    id: uuid.UUID
    collection_name: str


class CompanyCollectionOutput(CompanyBatchOutput, CompanyCollectionMetadata):
    pass


class AddCompaniesRequest(BaseModel):
    company_ids: list[int]


class OperationStatus(BaseModel):
    operation_id: str
    status: str  # "pending", "in_progress", "completed", "failed"
    progress: Optional[int] = None
    total: Optional[int] = None
    error_message: Optional[str] = None


class AddCompaniesResponse(BaseModel):
    operation_id: str
    message: str


# In-memory store for operation status tracking
operations_store = {}


@router.get("", response_model=list[CompanyCollectionMetadata])
def get_all_collection_metadata(
    db: Session = Depends(database.get_db),
):
    collections = db.query(database.CompanyCollection).all()

    return [
        CompanyCollectionMetadata(
            id=collection.id,
            collection_name=collection.collection_name,
        )
        for collection in collections
    ]


@router.get("/{collection_id}", response_model=CompanyCollectionOutput)
def get_company_collection_by_id(
    collection_id: uuid.UUID,
    offset: int = Query(
        0, description="The number of items to skip from the beginning"
    ),
    limit: int = Query(10, description="The number of items to fetch"),
    db: Session = Depends(database.get_db),
):
    query = (
        db.query(database.CompanyCollectionAssociation, database.Company)
        .join(database.Company)
        .filter(database.CompanyCollectionAssociation.collection_id == collection_id)
        .order_by(database.Company.id)
    )

    total_count = query.with_entities(func.count()).scalar()

    results = query.offset(offset).limit(limit).all()
    companies = fetch_companies_with_liked(db, [company.id for _, company in results])

    return CompanyCollectionOutput(
        id=collection_id,
        collection_name=db.query(database.CompanyCollection)
        .get(collection_id)
        .collection_name,
        companies=companies,
        total=total_count,
    )


async def add_companies_to_collection_task(
    operation_id: str,
    company_ids: list[int],
    source_collection_id: uuid.UUID,
    target_collection_id: uuid.UUID,
    db: Session
):
    """Background task to add companies to collection with progress tracking"""
    try:
        operations_store[operation_id]["status"] = "in_progress"
        operations_store[operation_id]["total"] = len(company_ids)
        
        # Filter out companies that are already in the target collection
        existing_associations = db.query(database.CompanyCollectionAssociation).filter(
            and_(
                database.CompanyCollectionAssociation.company_id.in_(company_ids),
                database.CompanyCollectionAssociation.collection_id == target_collection_id
            )
        ).all()
        
        existing_company_ids = {assoc.company_id for assoc in existing_associations}
        companies_to_add = [cid for cid in company_ids if cid not in existing_company_ids]
        
        operations_store[operation_id]["total"] = len(companies_to_add)
        
        # Add companies one by one to trigger the throttling mechanism
        for i, company_id in enumerate(companies_to_add):
            try:
                association = database.CompanyCollectionAssociation(
                    company_id=company_id,
                    collection_id=target_collection_id
                )
                db.add(association)
                db.commit()
                
                operations_store[operation_id]["progress"] = i + 1
                
            except Exception as e:
                db.rollback()
                # Skip duplicates but continue with others
                if "uq_company_collection" not in str(e):
                    raise e
        
        operations_store[operation_id]["status"] = "completed"
        
    except Exception as e:
        operations_store[operation_id]["status"] = "failed"
        operations_store[operation_id]["error_message"] = str(e)
        db.rollback()
    finally:
        db.close()


@router.post("/{source_collection_id}/add-to/{target_collection_id}", response_model=AddCompaniesResponse)
async def add_companies_to_collection(
    source_collection_id: uuid.UUID,
    target_collection_id: uuid.UUID,
    request: AddCompaniesRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(database.get_db)
):
    """Add selected companies from source collection to target collection"""
    
    # Validate collections exist
    source_collection = db.query(database.CompanyCollection).get(source_collection_id)
    target_collection = db.query(database.CompanyCollection).get(target_collection_id)
    
    if not source_collection or not target_collection:
        raise HTTPException(status_code=404, detail="Collection not found")
    
    # Validate that companies exist in source collection
    valid_company_ids = set()
    if request.company_ids:
        existing_in_source = db.query(database.CompanyCollectionAssociation).filter(
            and_(
                database.CompanyCollectionAssociation.company_id.in_(request.company_ids),
                database.CompanyCollectionAssociation.collection_id == source_collection_id
            )
        ).all()
        valid_company_ids = {assoc.company_id for assoc in existing_in_source}
        
        if len(valid_company_ids) != len(request.company_ids):
            raise HTTPException(status_code=400, detail="Some companies not found in source collection")
    
    operation_id = str(uuid.uuid4())
    operations_store[operation_id] = {
        "operation_id": operation_id,
        "status": "pending",
        "progress": 0,
        "total": len(request.company_ids),
        "error_message": None
    }
    
    # Create a new database session for the background task
    background_db = database.SessionLocal()
    background_tasks.add_task(
        add_companies_to_collection_task,
        operation_id,
        request.company_ids,
        source_collection_id,
        target_collection_id,
        background_db
    )
    
    return AddCompaniesResponse(
        operation_id=operation_id,
        message=f"Adding {len(request.company_ids)} companies to {target_collection.collection_name}"
    )


@router.post("/{source_collection_id}/add-all-to/{target_collection_id}", response_model=AddCompaniesResponse)
async def add_all_companies_to_collection(
    source_collection_id: uuid.UUID,
    target_collection_id: uuid.UUID,
    background_tasks: BackgroundTasks,
    db: Session = Depends(database.get_db)
):
    """Add all companies from source collection to target collection"""
    
    # Validate collections exist
    source_collection = db.query(database.CompanyCollection).get(source_collection_id)
    target_collection = db.query(database.CompanyCollection).get(target_collection_id)
    
    if not source_collection or not target_collection:
        raise HTTPException(status_code=404, detail="Collection not found")
    
    # Get all company IDs from source collection
    source_companies = db.query(database.CompanyCollectionAssociation).filter(
        database.CompanyCollectionAssociation.collection_id == source_collection_id
    ).all()
    
    company_ids = [assoc.company_id for assoc in source_companies]
    
    operation_id = str(uuid.uuid4())
    operations_store[operation_id] = {
        "operation_id": operation_id,
        "status": "pending",
        "progress": 0,
        "total": len(company_ids),
        "error_message": None
    }
    
    # Create a new database session for the background task
    background_db = database.SessionLocal()
    background_tasks.add_task(
        add_companies_to_collection_task,
        operation_id,
        company_ids,
        source_collection_id,
        target_collection_id,
        background_db
    )
    
    return AddCompaniesResponse(
        operation_id=operation_id,
        message=f"Adding all {len(company_ids)} companies from {source_collection.collection_name} to {target_collection.collection_name}"
    )


@router.get("/operations/{operation_id}", response_model=OperationStatus)
def get_operation_status(operation_id: str):
    """Get the status of a background operation"""
    if operation_id not in operations_store:
        raise HTTPException(status_code=404, detail="Operation not found")
    
    return OperationStatus(**operations_store[operation_id])
